import os
import boto3
import psycopg2
from botocore.exceptions import ClientError
import json
import logging
from psycopg2 import sql
from psycopg2.errors import DuplicateTable, DuplicateObject
import urllib3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

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
    response = client.get_secret_value(SecretId=secret_arn)
    return json.loads(response['SecretString'])

def check_migrations_applied(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            version VARCHAR(255) UNIQUE NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("SELECT COUNT(*) FROM migrations")
    count = cur.fetchone()[0]
    return count > 0

def apply_migrations(cur, conn):
    if check_migrations_applied(cur):
        logger.info("Migrations have already been applied. Skipping.")
        return

    cur.execute("SELECT version FROM migrations")
    applied_migrations = set(row[0] for row in cur.fetchall())
    logger.info(f"Already applied migrations: {applied_migrations}")

    current_dir = os.path.dirname(os.path.realpath(__file__))
    logger.info(f"Current directory: {current_dir}")
    migration_files = sorted([f for f in os.listdir(current_dir) if f.endswith('.sql')])
    logger.info(f"Found migration files: {migration_files}")

    for migration_file in migration_files:
        version = migration_file.split('__')[0]
        if version not in applied_migrations:
            logger.info(f"Applying new migration: {migration_file}")
            with open(os.path.join(current_dir, migration_file), 'r') as file:
                sql_content = file.read()

            try:
                with conn.cursor() as migration_cur:
                    migration_cur.execute("BEGIN")
                    try:
                        migration_cur.execute(sql_content)
                        migration_cur.execute(
                            sql.SQL("INSERT INTO migrations (version) VALUES (%s)"),
                            (version,)
                        )
                        conn.commit()
                        logger.info(f"Successfully applied migration: {migration_file}")
                    except (DuplicateTable, DuplicateObject) as e:
                        conn.rollback()
                        logger.warning(f"Skipping migration {migration_file} due to {str(e)}")
                    except Exception as e:
                        conn.rollback()
                        logger.error(f"Error applying migration {migration_file}: {str(e)}")
                        raise
            except Exception as e:
                logger.error(f"Transaction error for migration {migration_file}: {str(e)}")
                raise
        else:
            logger.info(f"Skipping already applied migration: {migration_file}")

    logger.info("All migrations have been checked and applied if necessary")

def lambda_handler(event, context):
    # Handle custom resource events
    if event.get('RequestType') == 'Delete':
        send_cfn_response(event, context, 'SUCCESS')
        return

    conn = None
    try:
        secret_arn = os.environ['DB_SECRET_ARN']
        db_name = os.environ['DB_NAME']
        logger.info("Successfully retrieved database secret ARN and DB name")
        secret = get_secret(secret_arn)

        conn = psycopg2.connect(
            host=secret['host'],
            port=secret['port'],
            dbname=db_name,
            user=secret['username'],
            password=secret['password']
        )
        logger.info("Successfully connected to the database")

        with conn.cursor() as cur:
            apply_migrations(cur, conn)
        logger.info("Database migrations completed successfully")

        send_cfn_response(event, context, 'SUCCESS', response_data={'Message': 'Database migrations complete'})
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