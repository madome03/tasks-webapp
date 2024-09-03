import os
import boto3
import psycopg2
import json
import logging
from botocore.exceptions import ClientError
from psycopg2 import sql
import urllib3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')

def send_cfn_response(event, context, response_status, reason=None, response_data=None, physical_resource_id=None):
    response_body = json.dumps({
        'Status': response_status,
        'Reason': reason or 'See the details in CloudWatch Log Stream: ' + context.log_stream_name,
        'PhysicalResourceId': physical_resource_id or context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'NoEcho': False,
        'Data': response_data or {}
    })

    http = urllib3.PoolManager()
    try:
        http.request('PUT', event['ResponseURL'], body=response_body, headers={'Content-Type': 'application/json'})
        logger.info("CFN response sent successfully")
    except Exception as e:
        logger.error(f"Failed to send CFN response: {str(e)}")

def get_secret(secret_arn):
    client = boto3.client('secretsmanager')
    try:
        response = client.get_secret_value(SecretId=secret_arn)
        secret = json.loads(response['SecretString'])
        return secret
    except ClientError as e:
        logger.error(f"Error retrieving secret: {str(e)}")
        raise e

def get_db_connection(secret):
    try:
        conn = psycopg2.connect(
            host=secret['host'],
            port=secret.get('port', 5432),  # Default PostgreSQL port is 5432
            dbname=os.environ['DB_NAME'],
            user=secret['username'],
            password=secret['password']
        )
        return conn
    except Exception as e:
        logger.error(f"Error connecting to database: {str(e)}")
        raise e

def get_database_schema(cur):
    cur.execute("""
        SELECT table_name, column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
    """)
    return cur.fetchall()

def upload_schema_to_s3(schema_info, bucket_name):
    try:
        s3_key = 'schema-info.json'
        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=json.dumps(schema_info, default=str),
            ContentType='application/json'
        )
        s3_url = f'https://{bucket_name}.s3.amazonaws.com/{s3_key}'
        logger.info(f"Schema uploaded to S3: {s3_url}")
        return s3_url
    except ClientError as e:
        logger.error(f"Failed to upload schema to S3: {str(e)}")
        raise e

def create_migration_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            migration_name VARCHAR(255) UNIQUE NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)

def get_applied_migrations(cur):
    cur.execute("SELECT migration_name FROM migrations")
    return set(row[0] for row in cur.fetchall())

def apply_migrations(cur, conn):
    migration_dir = os.path.join(os.path.dirname(__file__))
    migration_files = sorted([f for f in os.listdir(migration_dir) if f.endswith('.sql')])
    applied_migrations = get_applied_migrations(cur)
    migration_success = True

    try:
        for migration_file in migration_files:
            if migration_file not in applied_migrations:
                logger.info(f"Applying migration: {migration_file}")
                with open(os.path.join(migration_dir, migration_file), 'r') as f:
                    migration_sql = f.read()
                cur.execute(migration_sql)
                logger.info(f"Migration applied: {migration_file}")
        
        # If all migrations are successful, update the migrations table
        for migration_file in migration_files:
            if migration_file not in applied_migrations:
                cur.execute("INSERT INTO migrations (migration_name) VALUES (%s)", (migration_file,))
        
        conn.commit()
        logger.info("All migrations applied successfully")
    except Exception as e:
        conn.rollback()
        logger.error(f"Error applying migrations: {str(e)}")
        migration_success = False

    return migration_success

def lambda_handler(event, context):
    if event.get('RequestType') == 'Delete':
        send_cfn_response(event, context, 'SUCCESS')
        return

    conn = None
    try:
        secret_arn = os.environ['DB_SECRET_ARN']
        bucket_name = os.environ['SCHEMA_BUCKET_NAME']
        logger.info("Successfully retrieved database secret ARN and bucket name")

        secret = get_secret(secret_arn)

        conn = get_db_connection(secret)
        logger.info("Successfully connected to the database")

        migration_success = True
        with conn.cursor() as cur:
            create_migration_table(cur)
            migration_success = apply_migrations(cur, conn)
            
            schema_info = get_database_schema(cur)
            logger.info("Retrieved database schema information")

        s3_url = upload_schema_to_s3(schema_info, bucket_name)

        if migration_success:
            send_cfn_response(event, context, 'SUCCESS',
                              response_data={
                                  'Message': 'Migrations applied and database schema saved to S3',
                                  'SchemaS3Url': s3_url
                              })
        else:
            send_cfn_response(event, context, 'FAILED',
                              reason='Migrations failed, but current schema saved to S3',
                              response_data={
                                  'Message': 'Migrations failed, but current schema saved to S3',
                                  'SchemaS3Url': s3_url
                              })

    except psycopg2.OperationalError as e:
        logger.error(f"Database connection failed: {str(e)}")
        send_cfn_response(event, context, 'FAILED', reason=f'Database connection failed: {str(e)}')
    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        send_cfn_response(event, context, 'FAILED', reason=f'An error occurred: {str(e)}')
    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed")