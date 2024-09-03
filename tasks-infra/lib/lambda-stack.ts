import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
  public readonly mainFunction: lambda.Function;
  public readonly companyLogosBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // Create S3 bucket for company logos
    this.companyLogosBucket = new s3.Bucket(this, 'CompanyLogosBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const lambdaRole = this.createLambdaRole(props.databaseSecretArn);

    const commonLambdaProps = this.getCommonLambdaProps(props, lambdaRole);

    this.mainFunction = this.createLambdaFunction('MainFunction', 'lambda_handler.lambda_handler', '../../tasks-api/dependencies/lambda_backend.zip', commonLambdaProps);

    // Grant necessary permissions
    this.grantDatabaseAccess(props.database);
    this.grantS3Access();

    // Output the Lambda function ARN
    this.createOutputs();
  }

  private createLambdaRole(databaseSecretArn: string): iam.Role {
    const role = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambdaExecute'),
      ],
    });

    role.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [databaseSecretArn],
    }));

    return role;
  }

  private getCommonLambdaProps(props: LambdaStackProps, role: iam.Role): Partial<lambda.FunctionProps> {
    return {
      runtime: lambda.Runtime.PYTHON_3_9,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      role: role,
      environment: {
        DB_SECRET_ARN: props.databaseSecretArn,
        DB_NAME: 'tasksdb',
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_APP_CLIENT_ID: props.userPoolClient.userPoolClientId,
        COMPANY_LOGOS_BUCKET: this.companyLogosBucket.bucketName,
      },
    };
  }

  private createLambdaFunction(
    id: string,
    handler: string,
    codePath: string,
    props: Partial<lambda.FunctionProps>
  ): lambda.Function {
    return new lambda.Function(this, id, {
      ...props,
      handler: handler,
      code: lambda.Code.fromAsset(path.join(__dirname, codePath)),
      runtime: lambda.Runtime.PYTHON_3_9,
    });
  }

  private grantDatabaseAccess(database: rds.IDatabaseInstance) {
    database.grantConnect(this.mainFunction);
  }

  private grantS3Access() {
    this.companyLogosBucket.grantReadWrite(this.mainFunction);
  }

  private createOutputs() {
    new cdk.CfnOutput(this, 'MainFunctionArn', {
      value: this.mainFunction.functionArn,
      description: 'Main Lambda Function ARN',
      exportName: 'TasksMainFunctionArn',
    });

    new cdk.CfnOutput(this, 'CompanyLogosBucketName', {
      value: this.companyLogosBucket.bucketName,
      description: 'Company Logos S3 Bucket Name',
      exportName: 'CompanyLogosBucketName',
    });
  }
}