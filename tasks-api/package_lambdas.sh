#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

# Change to the tasks-api directory
cd "$(dirname "$0")"

# Function to package a Lambda
package_lambda() {
    local source_dir=$1
    local requirements_file=$2
    local output_zip=$3

    echo "Packaging $output_zip..."

    # Remove existing zip file if it exists
    rm -f "$output_zip"
    
    # Create a temporary directory for packaging
    mkdir -p temp_package

    # Copy the Lambda function code
    cp $source_dir/*.py temp_package/

    # Check if psycopg2-binary is in requirements.txt
    if grep -q "psycopg2-binary" "$requirements_file"; then
        echo "psycopg2-binary found in $requirements_file, installing with platform-specific options..."
        pip3.9 install --platform=manylinux1_x86_64 --only-binary=:all: psycopg2-binary -t temp_package/
    fi

    # Install other dependencies
    pip3.9 install -r $requirements_file -t temp_package/

    # Create the zip file
    cd temp_package
    zip -r ../$output_zip .
    cd ..

    # Clean up
    rm -rf temp_package

    echo "$output_zip packaged successfully"
}

# Package the main backend Lambda
package_lambda "backend" "backend/requirements.txt" "lambda_backend.zip"

# Package the DB initialization Lambda
package_lambda "dbInitLambda" "dbInitLambda/requirements.txt" "lambda_db_init.zip"

# Package the Cognito trigger functions
package_lambda "cognitoTriggers" "cognitoTriggers/requirements.txt" "lambda_cognito_triggers.zip"

# Package the Company Management Lambda
package_lambda "companyManagement" "companyManagement/requirements.txt" "lambda_company_management.zip"

# Package the User Management Lambda
package_lambda "userManagement" "userManagement/requirements.txt" "lambda_user_management.zip"

# Copy the SQL files into the db_init Lambda package
# Add SQL files to the db_init Lambda package
zip -j lambda_db_init.zip dbInitLambda/migrations/*.sql

echo "All Lambda functions packaged successfully"
