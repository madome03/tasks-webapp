#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

# Change to the project root directory
cd "$(dirname "$0")"

# Create the dependencies directory if it doesn't exist
mkdir -p dependencies

# Function to package a Lambda
package_lambda() {
    local source_dir=$1
    local output_zip=$2
    local requirements_file=$3

    echo "Packaging $output_zip..."

    # Remove existing zip file if it exists
    rm -f "dependencies/$output_zip"
    
    # Create a temporary directory for packaging
    mkdir -p temp_package

    # Copy the Lambda function code
    if [ "$source_dir" == "app" ]; then
        cp -R app/* temp_package/
        cp lambda_handler.py temp_package/
    elif [ "$source_dir" == "cognitoTriggers" ]; then
        cp -R cognitoTriggers/* temp_package/
    elif [ "$source_dir" == "dbInitLambda" ]; then
        cp -R dbInitLambda/* temp_package/
    fi

    # Install dependencies using the specific requirements.txt for this Lambda
    pip install -r $requirements_file -t temp_package/ --platform manylinux2014_x86_64 --only-binary=:all:

    # Create the zip file
    cd temp_package
    zip -r ../dependencies/$output_zip .
    cd ..

    # Clean up
    rm -rf temp_package

    echo "$output_zip packaged successfully and saved to dependencies/"
}

# Package the main Lambda using the app's requirements.txt
package_lambda "app" "lambda_backend.zip" "app/requirements.txt"

# Package the Cognito trigger functions using their specific requirements.txt
package_lambda "cognitoTriggers" "lambda_cognito_triggers.zip" "cognitoTriggers/requirements.txt"

# Package the DB initialization Lambda using its specific requirements.txt
package_lambda "dbInitLambda" "lambda_db_init.zip" "dbInitLambda/requirements.txt"

# Add SQL files to the db_init Lambda package
zip -j dependencies/lambda_db_init.zip dbInitLambda/migrations/*.sql

echo "All Lambda functions packaged successfully in the 'dependencies' folder"
