import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';

export class TasksInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Database name
    const dbName = 'tasksdb';

    // VPC
    const vpc = new ec2.Vpc(this, 'TasksVPC', {
      maxAzs: 2
    });

    // RDS Security Group
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc,
      description: 'Allow database connections for tasks db'
    });

    // RDS Instance
    const dbInstance = new rds.DatabaseInstance(this, 'TasksDB', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_13 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      databaseName: dbName,
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      storageEncrypted: true,
    });

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, 'TasksUserPool', {
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
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'TasksUserPoolClient', {
      userPool,
      generateSecret: false,
    });

    // DB Init Lambda
    const dbInitLambdaRole = new iam.Role(this, 'DBInitLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for DB init Lambda function',
    });

    dbInitLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));
    dbInitLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['rds-data:ExecuteStatement'],
      resources: [dbInstance.instanceArn],
    }));

    const dbInitFunction = new lambda.Function(this, 'DBInitFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_db_init.zip')),
      environment: {
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: dbName,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS},
      timeout: cdk.Duration.seconds(30),
      role: dbInitLambdaRole,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    dbInstance.grantConnect(dbInitFunction);
    if (dbInstance.secret) {
      dbInstance.secret.grantRead(dbInitFunction);
    }

    const migrationVersion = this.calculateMigrationHash();

    const dbInitCustomResource = new cdk.CustomResource(this, 'DBInit', {
      serviceToken: dbInitFunction.functionArn,
      properties: {
        MigrationVersion: migrationVersion,
      },
    });

    // Backend Lambda
    const backendLambdaRole = new iam.Role(this, 'BackendLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'IAM role for main backend Lambda function',
    });

    backendLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));
    backendLambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:*'],
      resources: [userPool.userPoolArn],
    }));

    const backendFunction = new lambda.Function(this, 'TasksFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'tasks.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_backend.zip')),
      environment: {
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: dbName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_APP_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      role: backendLambdaRole,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    dbInstance.grantConnect(backendFunction);
    if (dbInstance.secret) {
      dbInstance.secret.grantRead(backendFunction);
    }

    // Company Management Lambda
    const companyManagementFunction = new lambda.Function(this, 'CompanyManagementFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'companyManagementLambda.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_company_management.zip')),
      environment: {
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: dbName,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    dbInstance.grantConnect(companyManagementFunction);
    if (dbInstance.secret) {
      dbInstance.secret.grantRead(companyManagementFunction);
    }

    // Cognito Triggers
    const preSignUpTrigger = new lambda.Function(this, 'PreSignUpTrigger', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'preSignup.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_cognito_triggers.zip')),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: dbName,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const postConfirmationTrigger = new lambda.Function(this, 'PostConfirmationTrigger', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'postSignup.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../tasks-api/lambda_cognito_triggers.zip')),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        DB_SECRET_ARN: dbInstance.secret?.secretArn || '',
        DB_NAME: dbName,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    dbInstance.grantConnect(preSignUpTrigger);
    dbInstance.grantConnect(postConfirmationTrigger);
    if (dbInstance.secret) {
      dbInstance.secret.grantRead(preSignUpTrigger);
      dbInstance.secret.grantRead(postConfirmationTrigger);
    }

    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpTrigger);
    userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationTrigger);

    // API Gateway
    const api = new apigateway.RestApi(this, 'TasksApi', {
      restApiName: 'Tasks Service',
      description: 'This service serves tasks.',
      deploy: true,
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS
      },
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'TasksAuthorizer', {
      cognitoUserPools: [userPool],
    });

    // Lambda integrations
    const tasksIntegration = new apigateway.LambdaIntegration(backendFunction);
    const companyManagementIntegration = new apigateway.LambdaIntegration(companyManagementFunction);

    // API resources and methods
    this.createApiResources(api, tasksIntegration, companyManagementIntegration, authorizer);

    // Ensure that DBInit runs before the backend and other Lambdas
    backendFunction.node.addDependency(dbInitCustomResource);
    companyManagementFunction.node.addDependency(dbInitCustomResource);
    preSignUpTrigger.node.addDependency(dbInitCustomResource);
    postConfirmationTrigger.node.addDependency(dbInitCustomResource);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'URL of the API Gateway',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'ID of the Cognito User Pool',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'ID of the Cognito User Pool Client',
    });
  }

  private createApiResources(
    api: apigateway.RestApi, 
    tasksIntegration: apigateway.LambdaIntegration,
    companyManagementIntegration: apigateway.LambdaIntegration,
    authorizer: apigateway.CognitoUserPoolsAuthorizer
  ) {
    const tasks = api.root.addResource('tasks');
    tasks.addMethod('GET', tasksIntegration, { authorizer });
    tasks.addMethod('POST', tasksIntegration, { authorizer });

    const task = tasks.addResource('{taskId}');
    task.addMethod('GET', tasksIntegration, { authorizer });
    task.addMethod('PUT', tasksIntegration, { authorizer });
    task.addMethod('DELETE', tasksIntegration, { authorizer });

    const users = api.root.addResource('users');
    users.addMethod('POST', tasksIntegration, { authorizer });
    users.addMethod('GET', tasksIntegration, { authorizer });
    
    const user = users.addResource('{userId}');
    user.addMethod('GET', tasksIntegration, { authorizer });
    user.addMethod('PUT', tasksIntegration, { authorizer });
    user.addMethod('DELETE', tasksIntegration, { authorizer });

    const locations = api.root.addResource('locations');
    locations.addMethod('POST', tasksIntegration, { authorizer });
    locations.addMethod('GET', tasksIntegration, { authorizer });
    
    const location = locations.addResource('{locationId}');
    location.addMethod('GET', tasksIntegration, { authorizer });
    location.addMethod('PUT', tasksIntegration, { authorizer });
    location.addMethod('DELETE', tasksIntegration, { authorizer });

    const companies = api.root.addResource('companies');
    companies.addMethod('POST', companyManagementIntegration, { authorizer });
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