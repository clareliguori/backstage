/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DefaultAwsCredentialsProvider } from './DefaultAwsCredentialsProvider';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import {
  STSClient,
  GetCallerIdentityCommand,
  AssumeRoleCommand,
} from '@aws-sdk/client-sts';
import { Config, ConfigReader } from '@backstage/config';

const env = process.env;
let stsMock: AwsClientStub<STSClient>;
let config: Config;

describe('DefaultAwsCredentialsProvider', () => {
  beforeEach(() => {
    process.env = { ...env };
    jest.resetAllMocks();

    stsMock = mockClient(STSClient);

    config = new ConfigReader({
      integrations: {
        aws: {
          accounts: [
            {
              accountId: '111111111111',
              roleName: 'hello',
              externalId: 'world',
            },
            {
              accountId: '222222222222',
              roleName: 'hi',
              partition: 'aws-other',
              region: 'not-us-east-1',
              accessKeyId: 'ABC',
              secretAccessKey: 'EDF',
            },
            {
              accountId: '333333333333',
              accessKeyId: 'my-access-key',
              secretAccessKey: 'my-secret-access-key',
            },
            {
              accountId: '444444444444',
            },
          ],
          accountDefaults: {
            roleName: 'backstage-role',
            externalId: 'my-id',
          },
          mainAccount: {
            accessKeyId: 'GHI',
            secretAccessKey: 'JKL',
            region: 'ap-northeast-1',
          },
        },
      },
    });

    stsMock.on(GetCallerIdentityCommand).resolvesOnce({
      Account: '123456789012',
    });

    stsMock
      .on(AssumeRoleCommand, {
        RoleArn: 'arn:aws:iam::111111111111:role/hello',
        RoleSessionName: 'backstage',
        ExternalId: 'world',
      })
      .resolves({
        Credentials: {
          AccessKeyId: 'ACCESS_KEY_ID_1',
          SecretAccessKey: 'SECRET_ACCESS_KEY_1',
          SessionToken: 'SESSION_TOKEN_1',
          Expiration: new Date('2022-01-01'),
        },
      });

    stsMock
      .on(AssumeRoleCommand, {
        RoleArn: 'arn:aws-other:iam::222222222222:role/hi',
        RoleSessionName: 'backstage',
      })
      .resolves({
        Credentials: {
          AccessKeyId: 'ACCESS_KEY_ID_2',
          SecretAccessKey: 'SECRET_ACCESS_KEY_2',
          SessionToken: 'SESSION_TOKEN_2',
          Expiration: new Date('2022-01-02'),
        },
      });

    stsMock
      .on(AssumeRoleCommand, {
        RoleArn: 'arn:aws:iam::999999999999:role/backstage-role',
        RoleSessionName: 'backstage',
        ExternalId: 'my-id',
      })
      .resolves({
        Credentials: {
          AccessKeyId: 'ACCESS_KEY_ID_9',
          SecretAccessKey: 'SECRET_ACCESS_KEY_9',
          SessionToken: 'SESSION_TOKEN_9',
          Expiration: new Date('2022-01-09'),
        },
      });

    process.env.AWS_ACCESS_KEY_ID = 'ACCESS_KEY_ID_10';
    process.env.AWS_SECRET_ACCESS_KEY = 'SECRET_ACCESS_KEY_10';
    process.env.AWS_SESSION_TOKEN = 'SESSION_TOKEN_10';
    process.env.AWS_CREDENTIAL_EXPIRATION = new Date(
      '2022-01-10',
    ).toISOString();
  });

  afterEach(() => {
    process.env = env;
  });

  describe('#getCredentials', () => {
    it('retrieves assume-role creds for the given account ID', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        accountId: '111111111111',
      });

      expect(awsCredentials.accountId).toEqual('111111111111');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_1',
        secretAccessKey: 'SECRET_ACCESS_KEY_1',
        sessionToken: 'SESSION_TOKEN_1',
        expiration: new Date('2022-01-01'),
      });
    });

    it('retrieves assume-role creds in another partition for the given account ID', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        accountId: '222222222222',
      });

      expect(awsCredentials.accountId).toEqual('222222222222');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_2',
        secretAccessKey: 'SECRET_ACCESS_KEY_2',
        sessionToken: 'SESSION_TOKEN_2',
        expiration: new Date('2022-01-02'),
      });
    });

    it('retrieves assume-role creds for an account using the account defaults', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        accountId: '999999999999',
      });

      expect(awsCredentials.accountId).toEqual('999999999999');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_9',
        secretAccessKey: 'SECRET_ACCESS_KEY_9',
        sessionToken: 'SESSION_TOKEN_9',
        expiration: new Date('2022-01-09'),
      });
    });

    it('retrieves static creds for the given account ID', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        accountId: '333333333333',
      });

      expect(awsCredentials.accountId).toEqual('333333333333');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'my-access-key',
        secretAccessKey: 'my-secret-access-key',
      });
    });

    it('retrieves static creds from the main account', async () => {
      const minConfig = new ConfigReader({
        integrations: {
          aws: {
            mainAccount: {
              accessKeyId: 'GHI',
              secretAccessKey: 'JKL',
            },
          },
        },
      });
      const provider = DefaultAwsCredentialsProvider.fromConfig(minConfig);
      const awsCredentials = await provider.getCredentials({
        accountId: '123456789012',
      });

      expect(awsCredentials.accountId).toEqual('123456789012');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'GHI',
        secretAccessKey: 'JKL',
      });
    });

    it('retrieves the default cred provider chain for the given account ID', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        accountId: '444444444444',
      });

      expect(awsCredentials.accountId).toEqual('444444444444');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_10',
        secretAccessKey: 'SECRET_ACCESS_KEY_10',
        sessionToken: 'SESSION_TOKEN_10',
        expiration: new Date('2022-01-10'),
      });
    });

    it('retrieves default cred provider chain from the main account', async () => {
      const minConfig = new ConfigReader({
        integrations: {
          aws: {},
        },
      });
      const provider = DefaultAwsCredentialsProvider.fromConfig(minConfig);
      const awsCredentials = await provider.getCredentials({
        accountId: '123456789012',
      });

      expect(awsCredentials.accountId).toEqual('123456789012');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_10',
        secretAccessKey: 'SECRET_ACCESS_KEY_10',
        sessionToken: 'SESSION_TOKEN_10',
        expiration: new Date('2022-01-10'),
      });
    });

    it('retrieves default cred provider chain from the main account when there is no AWS integration config', async () => {
      const minConfig = new ConfigReader({
        integrations: {},
      });
      const provider = DefaultAwsCredentialsProvider.fromConfig(minConfig);
      const awsCredentials = await provider.getCredentials({
        accountId: '123456789012',
      });

      expect(awsCredentials.accountId).toEqual('123456789012');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_10',
        secretAccessKey: 'SECRET_ACCESS_KEY_10',
        sessionToken: 'SESSION_TOKEN_10',
        expiration: new Date('2022-01-10'),
      });
    });

    it('extracts the account ID from an ARN', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        arn: 'arn:aws:ecs:region:111111111111:service/cluster-name/service-name',
      });

      expect(awsCredentials.accountId).toEqual('111111111111');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'ACCESS_KEY_ID_1',
        secretAccessKey: 'SECRET_ACCESS_KEY_1',
        sessionToken: 'SESSION_TOKEN_1',
        expiration: new Date('2022-01-01'),
      });
    });

    it('falls back to main account credentials when account ID cannot be extracted from the ARN', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({
        arn: 'arn:aws:s3:::bucket_name',
      });

      expect(awsCredentials.accountId).toEqual('123456789012');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'GHI',
        secretAccessKey: 'JKL',
      });
    });

    it('falls back to main account credentials when neither account ID nor ARN are provided', async () => {
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      const awsCredentials = await provider.getCredentials({});

      expect(awsCredentials.accountId).toEqual('123456789012');

      const creds = await awsCredentials.provider();
      expect(creds).toEqual({
        accessKeyId: 'GHI',
        secretAccessKey: 'JKL',
      });
    });

    it('rejects account that is not configured, with no account defaults', async () => {
      const minConfig = new ConfigReader({
        integrations: {
          aws: {},
        },
      });
      const provider = DefaultAwsCredentialsProvider.fromConfig(minConfig);
      await expect(
        provider.getCredentials({ accountId: '111222333444' }),
      ).rejects.toThrow(/no AWS integration that matches 111222333444/);
    });

    it('rejects main account that has invalid credentials', async () => {
      stsMock.on(GetCallerIdentityCommand).rejects('No credentials found');
      const provider = DefaultAwsCredentialsProvider.fromConfig(config);
      await expect(provider.getCredentials({})).rejects.toThrow(
        /No credentials found/,
      );
    });
  });
});
