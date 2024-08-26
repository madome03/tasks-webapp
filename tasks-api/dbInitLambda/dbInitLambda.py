import os
import boto3
import psycopg2
from botocore.exceptions import ClientError
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def get_secret(secret_arn):
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_arn)
    return json.loads(response['SecretString'])


def apply_migrations(cur, conn):
    # Create migrations table if it doesn't exist
    cur.execute("""
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            version VARCHAR(255) UNIQUE NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Get list of applied migrations
    cur.execute("SELECT version FROM migrations")
    applied_migrations = set(row[0] for row in cur.fetchall())
    logger.info(f"Already applied migrations: {applied_migrations}")
    
    # Get list of all migration files
    current_dir = os.path.dirname(os.path.realpath(__file__))
    logger.info(f"Current directory: {current_dir}")
    migration_files = sorted([f for f in os.listdir(current_dir) if f.endswith('.sql')])
    logger.info(f"Found migration files: {migration_files}")
    
    for migration_file in migration_files:
        version = migration_file.split('__')[0]
        if version not in applied_migrations:
            logger.info(f"Applying new migration: {migration_file}")
            with open(os.path.join(current_dir, migration_file), 'r') as file:
                sql = file.read()
            cur.execute(sql)
            cur.execute("INSERT INTO migrations (version) VALUES (%s)", (version,))
            conn.commit()
            logger.info(f"Successfully applied migration: {migration_file}")
        else:
            logger.info(f"Skipping already applied migration: {migration_file}")
    
    logger.info("All migrations have been checked and applied if necessary")

def lambda_handler(event, context):
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

        return {
            'statusCode': 200,
            'body': 'Database migrations complete'
        }
    except psycopg2.OperationalError as e:
        logger.error(f"Database connection failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': f'Database connection failed: {str(e)}'
        }
    except Exception as e:
        logger.error(f"An error occurred: {str(e)}")
        return {
            'statusCode': 500,
            'body': f'An error occurred: {str(e)}'
        }
    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed")
