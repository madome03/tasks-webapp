import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

interface CognitoTriggersStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  databaseSecretArn: string;
  dbName: string;
}

export class CognitoTriggersStack extends cdk.Stack {
  public readonly preSignUpFunction: lambda.Function;
  public readonly postSignUpFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: CognitoTriggersStackProps) {
    super(scope, id, props);

    const userPoolIdParameter = new cdk.CfnParameter(this, 'UserPoolId', {
      type: 'String',
      description: 'The ID of the Cognito User Pool',
      default: '', // Make it optional
    });

    // Add a condition to check if UserPoolId is provided
    const userPoolIdProvidedCondition = new cdk.CfnCondition(this, 'UserPoolIdProvided', {
      expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(userPoolIdParameter.valueAsString, '')),
    });

    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_9,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.databaseSecretArn,
        DB_NAME: props.dbName,
        USER_POOL_ID: userPoolIdParameter.valueAsString,
      },
      timeout: cdk.Duration.seconds(30),
    };

    // Pre-SignUp Lambda
    this.preSignUpFunction = new lambda.Function(this, 'PreSignUpFunction', {
      ...commonLambdaProps,
      handler: 'preSignup.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/dependencies/lambda_cognito_triggers.zip')),
    });

    // Post-SignUp Lambda
    this.postSignUpFunction = new lambda.Function(this, 'PostSignUpFunction', {
      ...commonLambdaProps,
      handler: 'postSignup.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/dependencies/lambda_cognito_triggers.zip')),
    });

    // Grant the Lambda functions permission to read the secret
    const secret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DbSecret', props.databaseSecretArn);
    secret.grantRead(this.preSignUpFunction);
    secret.grantRead(this.postSignUpFunction);

    // Grant permissions to access Cognito
    const cognitoPolicy = new iam.PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [
        cdk.Fn.conditionIf(
          userPoolIdProvidedCondition.logicalId,
          cdk.Fn.join('', ['arn:aws:cognito-idp:', this.region, ':', this.account, ':userpool/', userPoolIdParameter.valueAsString]),
          '*' // Use a wildcard if UserPoolId is not provided
        ).toString()
      ],
    });
    
    this.preSignUpFunction.addToRolePolicy(cognitoPolicy);
    this.postSignUpFunction.addToRolePolicy(cognitoPolicy);

    // Outputs
    new cdk.CfnOutput(this, 'PreSignUpFunctionArn', {
      value: this.preSignUpFunction.functionArn,
      description: 'ARN of the Pre-SignUp Lambda Function',
      exportName: 'PreSignUpFunctionArn',
    });

    new cdk.CfnOutput(this, 'PostSignUpFunctionArn', {
      value: this.postSignUpFunction.functionArn,
      description: 'ARN of the Post-SignUp Lambda Function',
      exportName: 'PostSignUpFunctionArn',
    });
  }
}