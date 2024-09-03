import json
import os
import boto3
import psycopg2
from psycopg2.extras import RealDictCursor
from botocore.exceptions import ClientError

# Initialize AWS clients
cognito = boto3.client('cognito-idp')
secretsmanager = boto3.client('secretsmanager')

# Fetch configuration from environment variables
USER_POOL_ID = os.environ['COGNITO_USER_POOL_ID']
CLIENT_ID = os.environ['COGNITO_APP_CLIENT_ID']
DB_SECRET_ARN = os.environ['DB_SECRET_ARN']
DB_NAME = os.environ['DB_NAME']

def get_db_connection():
    try:
        secret = secretsmanager.get_secret_value(SecretId=DB_SECRET_ARN)
        secret_dict = json.loads(secret['SecretString'])
        
        conn = psycopg2.connect(
            host=secret_dict['host'],
            port=secret_dict['port'],
            dbname=DB_NAME,
            user=secret_dict['username'],
            password=secret_dict['password']
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {str(e)}")
        raise e

def create_user(event):
    user_data = json.loads(event['body'])
    try:
        # Create user in Cognito
        cognito_response = cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=user_data['email'],
            UserAttributes=[
                {'Name': 'email', 'Value': user_data['email']},
                {'Name': 'given_name', 'Value': user_data['first_name']},
                {'Name': 'family_name', 'Value': user_data['last_name']},
                {'Name': 'custom:company_id', 'Value': user_data['company_id']},
                {'Name': 'custom:role', 'Value': user_data['role']},
            ],
            TemporaryPassword=user_data['temporary_password']
        )
        
        # Insert user into database
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (cognito_user_id, email, first_name, last_name, company_id, role)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING user_id
            """, (
                cognito_response['User']['Username'],
                user_data['email'],
                user_data['first_name'],
                user_data['last_name'],
                user_data['company_id'],
                user_data['role']
            ))
            user_id = cur.fetchone()[0]
        conn.commit()
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'User created successfully', 'user_id': user_id})
        }
    except Exception as e:
        print(f"Error creating user: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def get_user(event):
    user_id = event['pathParameters']['userId']
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
            user = cur.fetchone()
        
        if user:
            return {
                'statusCode': 200,
                'body': json.dumps(user)
            }
        else:
            return {
                'statusCode': 404,
                'body': json.dumps({'message': 'User not found'})
            }
    except Exception as e:
        print(f"Error getting user: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def update_user(event):
    user_id = event['pathParameters']['userId']
    user_data = json.loads(event['body'])
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE users
                SET first_name = %s, last_name = %s, role = %s
                WHERE user_id = %s
            """, (
                user_data['first_name'],
                user_data['last_name'],
                user_data['role'],
                user_id
            ))
        conn.commit()
        
        # Update user in Cognito
        cognito_user_id = get_cognito_user_id(user_id)
        cognito.admin_update_user_attributes(
            UserPoolId=USER_POOL_ID,
            Username=cognito_user_id,
            UserAttributes=[
                {'Name': 'given_name', 'Value': user_data['first_name']},
                {'Name': 'family_name', 'Value': user_data['last_name']},
                {'Name': 'custom:role', 'Value': user_data['role']},
            ]
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'User updated successfully'})
        }
    except Exception as e:
        print(f"Error updating user: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def delete_user(event):
    user_id = event['pathParameters']['userId']
    try:
        # Delete user from database
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
        conn.commit()
        
        # Delete user from Cognito
        cognito_user_id = get_cognito_user_id(user_id)
        cognito.admin_delete_user(
            UserPoolId=USER_POOL_ID,
            Username=cognito_user_id
        )
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'User deleted successfully'})
        }
    except Exception as e:
        print(f"Error deleting user: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def get_cognito_user_id(user_id):
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT cognito_user_id FROM users WHERE user_id = %s", (user_id,))
        result = cur.fetchone()
    return result[0] if result else None

def handler(event, context):
    http_method = event['httpMethod']
    resource = event['resource']
    
    if resource == '/users' and http_method == 'POST':
        return create_user(event)
    elif resource == '/users/{userId}':
        if http_method == 'GET':
            return get_user(event)
        elif http_method == 'PUT':
            return update_user(event)
        elif http_method == 'DELETE':
            return delete_user(event)
    
    return {
        'statusCode': 400,
        'body': json.dumps({'message': 'Invalid endpoint or method'})
    }