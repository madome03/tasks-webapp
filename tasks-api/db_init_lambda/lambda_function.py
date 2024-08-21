# db_init_lambda/lambda_function.py

import os
import boto3
import psycopg2
from botocore.exceptions import ClientError
import json

def get_secret():
    secret_name = os.environ['DB_SECRET_ARN']
    region_name = boto3.session.Session().region_name

    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
    except ClientError as e:
        raise e

    secret = get_secret_value_response['SecretString']
    return json.loads(secret)

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
    
    # Get list of all migration files
    try:
        migration_files = sorted([f for f in os.listdir('migrations') if f.endswith('.sql')])
    except FileNotFoundError:
        print("Error: 'migrations' directory not found")
        return
    
    for migration_file in migration_files:
        version = migration_file.split('__')[0]
        if version not in applied_migrations:
            print(f"Applying migration: {migration_file}")
            with open(os.path.join('migrations', migration_file), 'r') as file:
                sql = file.read()
            cur.execute(sql)
            cur.execute("INSERT INTO migrations (version) VALUES (%s)", (version,))
            conn.commit()

def lambda_handler(event, context):
    secret = get_secret()

    conn = psycopg2.connect(
        host=secret['host'],
        database=os.environ['DB_NAME'],
        user=secret['username'],
        password=secret['password']
    )

    try:
        with conn.cursor() as cur:
            apply_migrations(cur, conn)
        print("Database migrations completed successfully")
    except Exception as e:
        print(f"An error occurred: {e}")
        conn.rollback()
    finally:
        conn.close()

    return {
        'statusCode': 200,
        'body': 'Database migrations complete'
    }