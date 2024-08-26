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

def handler(event, context):
    user_pool_id = os.environ['USER_POOL_ID']
    db_name = os.environ['DB_NAME']

    user_attributes = {attr['Name']: attr['Value'] for attr in event['request']['userAttributes']}
    
    # Get database connection details
    secret = get_secret()
    
    # Connect to the database
    conn = psycopg2.connect(
        host=secret['host'],
        database=db_name,
        user=secret['username'],
        password=secret['password']
    )
    
    try:
        with conn.cursor() as cur:
            # Check if this is the first user for the company
            cur.execute("SELECT COUNT(*) FROM users WHERE company_id = %s", (user_attributes['custom:company_id'],))
            is_first_user = cur.fetchone()[0] == 0

            # Insert the new user into the users table
            cur.execute("""
                INSERT INTO users (cognito_user_id, profile_type, company_id, fname, lname, email)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING user_id
            """, (
                user_attributes['sub'],
                user_attributes['custom:role'],
                user_attributes['custom:company_id'],
                user_attributes['given_name'],
                user_attributes['family_name'],
                user_attributes['email']
            ))
            
            new_user_id = cur.fetchone()[0]
            
            # If location_id was provided, update the user with it
            if 'custom:location_id' in user_attributes:
                cur.execute("""
                    UPDATE users
                    SET location_id = %s
                    WHERE user_id = %s
                """, (user_attributes['custom:location_id'], new_user_id))
            
            # If this is the first user, create a default location for the company
            if is_first_user:
                cur.execute("""
                    INSERT INTO locations (company_id, name, address)
                    VALUES (%s, 'Default Location', 'Default Address')
                    RETURNING location_id
                """, (user_attributes['custom:company_id'],))
                default_location_id = cur.fetchone()[0]
                
                # Assign the default location to the user
                cur.execute("""
                    UPDATE users
                    SET location_id = %s
                    WHERE user_id = %s
                """, (default_location_id, new_user_id))
            
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

    return event