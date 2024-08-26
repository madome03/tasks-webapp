import os
import json
import boto3
import psycopg2
import uuid
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

def create_company(company_name):
    secret = get_secret()
    conn = psycopg2.connect(
        host=secret['host'],
        database=os.environ['DB_NAME'],
        user=secret['username'],
        password=secret['password']
    )
    
    try:
        with conn.cursor() as cur:
            company_id = str(uuid.uuid4())  # Generate a unique company ID
            cur.execute("INSERT INTO companies (company_id, name) VALUES (%s, %s)", (company_id, company_name))
        conn.commit()
        return company_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def handler(event, context):
    if event['httpMethod'] == 'POST':
        body = json.loads(event['body'])
        company_name = body.get('company_name')
        
        if not company_name:
            return {
                'statusCode': 400,
                'body': json.dumps('Company name is required')
            }
        
        try:
            company_id = create_company(company_name)
            return {
                'statusCode': 200,
                'body': json.dumps({'company_id': company_id, 'message': 'Company created successfully'})
            }
        except Exception as e:
            return {
                'statusCode': 500,
                'body': json.dumps(f'Error creating company: {str(e)}')
            }
    else:
        return {
            'statusCode': 405,
            'body': json.dumps('Method not allowed')
        }