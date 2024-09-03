import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';

interface DbInitStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  database: rds.IDatabaseInstance;
  databaseSecretArn: string;
  dbName: string;
}

export class DbInitStack extends cdk.Stack {
  public readonly dbInitFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: DbInitStackProps) {
    super(scope, id, props);

    // Create S3 bucket to store schema information
    const schemaBucket = new s3.Bucket(this, 'SchemaBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,  // Auto-delete bucket when stack is destroyed
    });

    // DB Init Lambda
    this.dbInitFunction = new lambda.Function(this, 'DBInitFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'dbInitLambda.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/dependencies/lambda_db_init.zip')),
      environment: {
        DB_SECRET_ARN: props.databaseSecretArn,
        DB_NAME: props.dbName,
        SCHEMA_BUCKET_NAME: schemaBucket.bucketName,  // Pass S3 bucket name to Lambda
      },
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      timeout: cdk.Duration.seconds(600),
    });

    // Grant the Lambda function permission to read the secret and write to the S3 bucket
    const secret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DbSecret', props.databaseSecretArn);
    secret.grantRead(this.dbInitFunction);
    schemaBucket.grantPut(this.dbInitFunction);  // Grant write permissions to the Lambda function

    const migrationVersion = this.calculateMigrationHash();

    // Create custom resource to trigger DB init
    const dbInitCustomResource = new cdk.CustomResource(this, 'DBInit', {
      serviceToken: this.dbInitFunction.functionArn,
      properties: {
        MigrationVersion: migrationVersion,
      },
    });

    // Ensure the database is created before running migrations
    dbInitCustomResource.node.addDependency(props.database);

    // Create a CloudFormation output for the S3 URL of the schema
    new cdk.CfnOutput(this, 'DatabaseSchemaUrl', {
      value: `https://${schemaBucket.bucketRegionalDomainName}/schema-info.json`,
      description: 'URL for the database schema JSON in S3',
    });
  }

  private calculateMigrationHash(): string {
    const migrationDir = path.join(__dirname, '../../tasks-api/dbInitLambda/migrations');
    const migrationFiles = fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql'));
    const migrationHash = crypto.createHash('md5');
    for (const file of migrationFiles) {
      const content = fs.readFileSync(path.join(migrationDir, file));
      migrationHash.update(content);
    }
    return migrationHash.digest('hex');
  }
}
