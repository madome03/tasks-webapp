import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';

interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly databaseSecretArn: string;
  public readonly dbInitCustomResource: cdk.CustomResource;
  public readonly dbName: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.dbName = 'tasksdb';

    // Create security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc: props.vpc,
      description: 'Allow database connections for tasks db'
    });

    // Allow inbound connection from Lambda security group
    dbSecurityGroup.addIngressRule(
      props.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to RDS'
    );

     // Create RDS instance with a secret
     this.database = new rds.DatabaseInstance(this, 'TasksDB', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_13 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      databaseName: this.dbName,
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'), // This creates a secret automatically
      storageEncrypted: true,
    });

    this.databaseSecretArn = this.database.secret?.secretArn || '';

    // DB Init Lambda
    const dbInitFunction = new lambda.Function(this, 'DBInitFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'dbInitLambda.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_db_init.zip')),
      environment: {
        DB_SECRET_ARN: this.databaseSecretArn,
        DB_NAME: this.dbName,
      },
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
      timeout: cdk.Duration.seconds(120),
    });
    

    // Grant the Lambda function permission to read the secret
    if (this.database.secret) {
      this.database.secret.grantRead(dbInitFunction);
    }

    // Allow DB Init Lambda to connect to RDS
    dbSecurityGroup.addIngressRule(
      props.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow DB Init Lambda to connect to RDS'
    );

    const migrationVersion = this.calculateMigrationHash();

    // Create custom resource to trigger DB init
    this.dbInitCustomResource = new cdk.CustomResource(this, 'DBInit', {
      serviceToken: dbInitFunction.functionArn,
      properties: {
        MigrationVersion: migrationVersion,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'Database endpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecretArn,
      description: 'Database secret ARN',
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