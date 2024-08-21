import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';

export class TasksInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC
    const vpc = new ec2.Vpc(this, 'TasksVPC', {
      maxAzs: 2
    });

    // Create a security group for the RDS instance
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc,
      description: 'Allow database connections'
    });

    // Create the RDS instance
    const dbInstance = new rds.DatabaseInstance(this, 'TasksDB', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_13 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
      securityGroups: [dbSecurityGroup],
      databaseName: 'tasksdb',
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
    });

    // Calculate hash of migration files
    const migrationDir = path.join(__dirname, '../../tasks-api/db_init_lambda/migrations');
    const migrationFiles = fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql'));
    const migrationHash = crypto.createHash('md5');
    for (const file of migrationFiles) {
      const content = fs.readFileSync(path.join(migrationDir, file));
      migrationHash.update(content);
    }
    const migrationVersion = migrationHash.digest('hex');

    // Create the DB initialization Lambda function
    const dbInitFunction = new lambda.Function(this, 'DBInitFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_db_init.zip')),
      environment: {
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: 'tasksdb',
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS},
      timeout: cdk.Duration.seconds(30),
    });

    // Grant the DB init Lambda function necessary permissions
    dbInstance.grantConnect(dbInitFunction);
    if (dbInstance.secret) {
      dbInstance.secret.grantRead(dbInitFunction);
    }
    dbInitFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rds-data:ExecuteStatement'],
      resources: [dbInstance.instanceArn],
    }));

    // Create a custom resource to run the DB init function
    const dbInitCustomResource = new cdk.CustomResource(this, 'DBInit', {
      serviceToken: dbInitFunction.functionArn,
      properties: {
        MigrationVersion: migrationVersion,
      },
    });

    // Create the main backend Lambda function
    const backendFunction = new lambda.Function(this, 'TasksFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'tasks.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_backend.zip')),
      environment: {
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: 'tasksdb',
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Add dependency to ensure DB init runs before backend function
    backendFunction.node.addDependency(dbInitCustomResource);

    // Grant the backend Lambda function necessary permissions
    dbInstance.grantConnect(backendFunction);
    if (dbInstance.secret) {
      dbInstance.secret.grantRead(backendFunction);
    }

    // Add Function URL to the backend Lambda
    const fnUrl = backendFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Change to AWS_IAM for production
    });

    // Output the Function URL
    new cdk.CfnOutput(this, 'TasksApiURL', {
      value: fnUrl.url,
      description: 'URL of the tasks api',
    });
  }
}