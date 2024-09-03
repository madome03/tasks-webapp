import os
import json
import boto3
import psycopg2
from botocore.exceptions import ClientError
from app.core.config import settings

def get_secret():
    secret_name = settings.DB_SECRET_ARN
    region_name = settings.AWS_REGION

    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        secret = json.loads(get_secret_value_response['SecretString'])
        return secret
    except ClientError as e:
        raise e

def get_db_connection():
    try:
        secret = get_secret()
        conn = psycopg2.connect(
            host=secret['host'],
            port=secret.get('port', 5432),
            dbname=settings.DB_NAME,
            user=secret['username'],
            password=secret['password']
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {str(e)}")
        raise e

# You can add more database utility functions here if needed