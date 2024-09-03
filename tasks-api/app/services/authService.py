import boto3
from botocore.exceptions import ClientError
from fastapi import HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from app.core.config import settings

cognito_client = boto3.client('cognito-idp', region_name=settings.AWS_REGION)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        response = cognito_client.get_user(AccessToken=token)
        user_attributes = {attr['Name']: attr['Value'] for attr in response['UserAttributes']}
        return {
            'username': response['Username'],
            'email': user_attributes.get('email'),
            'role': user_attributes.get('custom:role'),
            'company_id': user_attributes.get('custom:company_id')
        }
    except ClientError as e:
        raise credentials_exception

def is_super_admin(user: dict):
    return user['role'] == 'super_admin'

def can_access_company(user: dict, company_id: int):
    return is_super_admin(user) or str(user['company_id']) == str(company_id)

def can_manage_company(user: dict, company_id: int):
    return is_super_admin(user) or (user['role'] == 'admin' and str(user['company_id']) == str(company_id))

# Add more authorization functions as needed