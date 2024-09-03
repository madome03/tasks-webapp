import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';

interface CognitoStackProps extends cdk.StackProps {
  preSignUpFunctionArn: string;
  postSignUpFunctionArn: string;
}

export class CognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const preSignUpFunction = lambda.Function.fromFunctionArn(this, 'PreSignUpFunction', props.preSignUpFunctionArn);
    const postSignUpFunction = lambda.Function.fromFunctionArn(this, 'PostSignUpFunction', props.postSignUpFunctionArn);

    this.userPool = new cognito.UserPool(this, 'TasksUserPool', {
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
        email: { required: true, mutable: false },
      },
      customAttributes: {
        company_id: new cognito.StringAttribute({ mutable: false }),
        role: new cognito.StringAttribute({ mutable: true }),
        location_id: new cognito.NumberAttribute({ mutable: true }),
        profile_type: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      lambdaTriggers: {
        preSignUp: preSignUpFunction,
        postConfirmation: postSignUpFunction,
      },
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'TasksUserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'ID of the Cognito User Pool',
      exportName: 'UserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'ID of the Cognito User Pool Client',
    });
  }
}