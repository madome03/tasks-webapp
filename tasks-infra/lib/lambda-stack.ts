import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as path from 'path';

interface LambdaStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  database: rds.IDatabaseInstance;
  databaseSecretArn: string;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

export class LambdaStack extends cdk.Stack {
  public readonly backendFunction: lambda.Function;
  public readonly companyManagementFunction: lambda.Function;
  public readonly userManagementFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambdaExecute'),
      ],
    });

    // Grant read access to the database secret
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.databaseSecretArn],
    }));

    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_9,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, // Updated this line
      securityGroups: [props.lambdaSecurityGroup],
      role: lambdaRole,
      environment: {
        DB_SECRET_ARN: props.databaseSecretArn,
        DB_NAME: 'tasksdb',
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_APP_CLIENT_ID: props.userPoolClient.userPoolClientId,
      },
    };

    this.backendFunction = new lambda.Function(this, 'TasksFunction', {
      ...commonLambdaProps,
      handler: 'tasks.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_backend.zip')),
    });

    this.companyManagementFunction = new lambda.Function(this, 'CompanyManagementFunction', {
      ...commonLambdaProps,
      handler: 'companyManagementLambda.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_company_management.zip')),
    });

    this.userManagementFunction = new lambda.Function(this, 'UserManagementFunction', {
      ...commonLambdaProps,
      handler: 'userManagementLambda.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_user_management.zip')),
    });

    // Grant necessary permissions
    props.database.grantConnect(this.backendFunction);
    props.database.grantConnect(this.companyManagementFunction);
    props.database.grantConnect(this.userManagementFunction);

    // Output the Lambda function ARNs
    new cdk.CfnOutput(this, 'BackendFunctionArn', {
      value: this.backendFunction.functionArn,
      description: 'Backend Lambda Function ARN',
      exportName: 'TasksBackendFunctionArn',
    });

    new cdk.CfnOutput(this, 'CompanyManagementFunctionArn', {
      value: this.companyManagementFunction.functionArn,
      description: 'Company Management Lambda Function ARN',
      exportName: 'TasksCompanyManagementFunctionArn',
    });

    new cdk.CfnOutput(this, 'UserManagementFunctionArn', {
      value: this.userManagementFunction.functionArn,
      description: 'User Management Lambda Function ARN',
      exportName: 'TasksUserManagementFunctionArn',
    });
  }
}