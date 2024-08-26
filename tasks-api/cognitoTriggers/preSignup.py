import os
import boto3
import psycopg2
from botocore.exceptions import ClientError

def get_secret():
    secret_name = os.environ['DB_SECRET_ARN']
    region_name = os.environ['AWS_REGION']

    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
    except ClientError as e:
        raise e

    secret = eval(get_secret_value_response['SecretString'])
    return secret

def check_company_exists(company_id):
    secret = get_secret()
    conn = psycopg2.connect(
        host=secret['host'],
        database=os.environ['DB_NAME'],
        user=secret['username'],
        password=secret['password']
    )
    
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM companies WHERE company_id = %s", (company_id,))
            count = cur.fetchone()[0]
        return count > 0
    finally:
        conn.close()

def check_company_has_users(company_id):
    secret = get_secret()
    conn = psycopg2.connect(
        host=secret['host'],
        database=os.environ['DB_NAME'],
        user=secret['username'],
        password=secret['password']
    )
    
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users WHERE company_id = %s", (company_id,))
            count = cur.fetchone()[0]
        return count > 0
    finally:
        conn.close()

def handler(event, context):
    user_pool_id = os.environ['USER_POOL_ID']
    client = boto3.client('cognito-idp')

    user_attributes = {attr['Name']: attr['Value'] for attr in event['request']['userAttributes']}
    
    # Ensure company_id is provided
    if 'custom:company_id' not in user_attributes:
        raise Exception("Company ID is required")
    
    company_id = user_attributes['custom:company_id']
    
    # Check if the company exists
    if not check_company_exists(company_id):
        raise Exception("Invalid company ID")
    
    # Check if this is the first user for the company
    is_first_user = not check_company_has_users(company_id)
    
    if is_first_user:
        # If this is the first user, they must be a super_admin
        if user_attributes.get('custom:role') != 'super_admin':
            raise Exception("The first user for a company must be a super_admin")
    else:
        # If not the first user, check if the creating user is an admin or super_admin
        try:
            creating_user = client.admin_get_user(
                UserPoolId=user_pool_id,
                Username=context.identity.username
            )
            creating_user_attributes = {attr['Name']: attr['Value'] for attr in creating_user['UserAttributes']}
            
            if creating_user_attributes.get('custom:role') not in ['admin', 'super_admin']:
                raise Exception("Only admins or super admins can create new users")
            
            # Ensure role is provided and valid
            if 'custom:role' not in user_attributes or user_attributes['custom:role'] not in ['admin', 'employee', 'super_admin']:
                raise Exception("Valid role (admin, employee, or super_admin) is required")
            
            # If the new user is an admin or super_admin, ensure the creating user is a super_admin
            if user_attributes['custom:role'] in ['admin', 'super_admin'] and creating_user_attributes.get('custom:role') != 'super_admin':
                raise Exception("Only super admins can create admin or super admin users")
            
        except ClientError:
            # If admin_get_user fails, it means this is a sign-up attempt not initiated by an admin
            raise Exception("Direct sign-ups are not allowed. Please contact your administrator.")

    return event