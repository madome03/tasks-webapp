from core.logger import get_logger
from fastapi import HTTPException, UploadFile
from app.core.database import get_db_connection
from app.models.company import Company, CompanyCreate, CompanyUpdate, Location, CompanyResponse
import boto3
from botocore.exceptions import ClientError
from app.core.config import settings
from typing import List

logger = get_logger(__name__)
s3_client = boto3.client('s3', region_name=settings.AWS_REGION)

async def create_company(company: CompanyCreate, logo: UploadFile = None) -> CompanyResponse:
    logger.info(f"Creating new company: {company.name}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO companies (name) VALUES (%s) RETURNING company_id",
                (company.name,)
            )
            company_id = cur.fetchone()[0]
            logger.info(f"Company created with ID: {company_id}")

            for location in company.locations:
                cur.execute(
                    "INSERT INTO locations (company_id, name, address) VALUES (%s, %s, %s)",
                    (company_id, location.name, location.address)
                )
            logger.info(f"Added {len(company.locations)} locations for company {company_id}")

            logo_url = None
            if logo:
                logo_url = await upload_logo(company_id, logo)
                cur.execute(
                    "UPDATE companies SET logo_url = %s WHERE company_id = %s",
                    (logo_url, company_id)
                )
                logger.info(f"Uploaded logo for company {company_id}")

            conn.commit()

            return CompanyResponse(
                id=company_id,
                name=company.name,
                logo_url=logo_url,
                locations=company.locations
            )
    except Exception as e:
        conn.rollback()
        logger.error(f"Error creating company: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

async def get_company(company_id: int) -> CompanyResponse:
    logger.info(f"Fetching company with ID: {company_id}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, logo_url FROM companies WHERE company_id = %s",
                (company_id,)
            )
            company = cur.fetchone()
            if not company:
                logger.warning(f"Company with ID {company_id} not found")
                raise HTTPException(status_code=404, detail="Company not found")
            
            cur.execute(
                "SELECT name, address FROM locations WHERE company_id = %s",
                (company_id,)
            )
            locations = [Location(name=row[0], address=row[1]) for row in cur.fetchall()]

        return CompanyResponse(
            id=company_id,
            name=company[0],
            logo_url=company[1],
            locations=locations
        )
    except Exception as e:
        logger.error(f"Error fetching company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

async def update_company(company_id: int, company_update: CompanyUpdate) -> CompanyResponse:
    logger.info(f"Updating company with ID: {company_id}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE companies SET name = %s WHERE company_id = %s",
                (company_update.name, company_id)
            )
            if cur.rowcount == 0:
                logger.warning(f"Company with ID {company_id} not found for update")
                raise HTTPException(status_code=404, detail="Company not found")
            conn.commit()
        return await get_company(company_id)
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

async def add_location(company_id: int, location: Location) -> Location:
    logger.info(f"Adding new location for company ID: {company_id}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO locations (company_id, name, address) VALUES (%s, %s, %s) RETURNING location_id",
                (company_id, location.name, location.address)
            )
            location_id = cur.fetchone()[0]
            conn.commit()
        logger.info(f"Added location with ID {location_id} to company {company_id}")
        return Location(id=location_id, name=location.name, address=location.address)
    except Exception as e:
        conn.rollback()
        logger.error(f"Error adding location to company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

async def update_location(company_id: int, location_id: int, location: Location) -> Location:
    logger.info(f"Updating location ID: {location_id} for company ID: {company_id}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE locations SET name = %s, address = %s WHERE location_id = %s AND company_id = %s",
                (location.name, location.address, location_id, company_id)
            )
            if cur.rowcount == 0:
                logger.warning(f"Location with ID {location_id} not found for company {company_id}")
                raise HTTPException(status_code=404, detail="Location not found")
            conn.commit()
        logger.info(f"Updated location {location_id} for company {company_id}")
        return Location(id=location_id, name=location.name, address=location.address)
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating location {location_id} for company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

async def delete_location(company_id: int, location_id: int):
    logger.info(f"Deleting location ID: {location_id} for company ID: {company_id}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM locations WHERE location_id = %s AND company_id = %s",
                (location_id, company_id)
            )
            if cur.rowcount == 0:
                logger.warning(f"Location with ID {location_id} not found for company {company_id}")
                raise HTTPException(status_code=404, detail="Location not found")
            conn.commit()
        logger.info(f"Deleted location {location_id} for company {company_id}")
    except Exception as e:
        conn.rollback()
        logger.error(f"Error deleting location {location_id} for company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

async def upload_logo(company_id: int, logo: UploadFile) -> str:
    logger.info(f"Uploading logo for company ID: {company_id}")
    try:
        logo_key = f"company_logos/{company_id}.png"
        s3_client.upload_fileobj(logo.file, settings.COMPANY_LOGOS_BUCKET, logo_key)
        logo_url = f"https://{settings.COMPANY_LOGOS_BUCKET}.s3.amazonaws.com/{logo_key}"
        
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE companies SET logo_url = %s WHERE company_id = %s",
                    (logo_url, company_id)
                )
                conn.commit()
        finally:
            conn.close()
        
        logger.info(f"Logo uploaded successfully for company {company_id}")
        return logo_url
    except ClientError as e:
        logger.error(f"Error uploading logo for company {company_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def list_companies(skip: int = 0, limit: int = 100) -> List[CompanyResponse]:
    logger.info(f"Listing companies with skip: {skip}, limit: {limit}")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.company_id, c.name, c.logo_url, 
                       array_agg(json_build_object('name', l.name, 'address', l.address)) as locations
                FROM companies c
                LEFT JOIN locations l ON c.company_id = l.company_id
                GROUP BY c.company_id, c.name, c.logo_url
                ORDER BY c.company_id
                LIMIT %s OFFSET %s
                """,
                (limit, skip)
            )
            companies = cur.fetchall()

        return [
            CompanyResponse(
                id=row[0],
                name=row[1],
                logo_url=row[2],
                locations=[Location(**loc) for loc in row[3] if loc['name'] is not None]
            )
            for row in companies
        ]
    except Exception as e:
        logger.error(f"Error listing companies: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()