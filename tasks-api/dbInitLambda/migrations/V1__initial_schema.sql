-- V1__initial_schema_combined.sql

-- Create Companies table
CREATE TABLE companies (
    company_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Locations table
CREATE TABLE locations (
    location_id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(company_id),
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Users table with separated user_id and cognito_user_id
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    cognito_user_id VARCHAR(255) UNIQUE NOT NULL,
    profile_type VARCHAR(20) NOT NULL CHECK (profile_type IN ('super_admin', 'admin', 'employee')),
    creation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fname VARCHAR(50) NOT NULL,
    lname VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    location_id INTEGER REFERENCES locations(location_id),
    created_by INTEGER REFERENCES users(user_id),
    company_id INTEGER REFERENCES companies(company_id)
);

-- Create Tasks table
CREATE TABLE tasks (
    task_id SERIAL PRIMARY KEY,
    creation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source INTEGER NOT NULL REFERENCES users(user_id),
    creation_date_by_user DATE NOT NULL,
    location_id INTEGER REFERENCES locations(location_id),
    task_title VARCHAR(200) NOT NULL,
    description TEXT,
    due_date DATE,
    assigned_to INTEGER REFERENCES users(user_id),
    is_pooled BOOLEAN NOT NULL DEFAULT FALSE,
    completed_timestamp TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in progress', 'completed')),
    edit_timestamp TIMESTAMP WITH TIME ZONE,
    priority INTEGER CHECK (priority BETWEEN 1 AND 5)
);

-- Create Task_Changes table for tracking edits
CREATE TABLE task_changes (
    change_id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(task_id),
    change_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    field_name VARCHAR(50) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_by INTEGER NOT NULL REFERENCES users(user_id)
);

-- Create indexes for improved query performance
CREATE INDEX idx_users_profile_type ON users(profile_type);
CREATE INDEX idx_users_cognito_id ON users(cognito_user_id);
CREATE INDEX idx_users_location_id ON users(location_id);
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_location_id ON tasks(location_id);
CREATE INDEX idx_tasks_source ON tasks(source);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_locations_company_id ON locations(company_id);

-- Create views for dashboard queries
CREATE VIEW employee_dashboard AS
SELECT 
    u.user_id,
    u.cognito_user_id,
    u.company_id,
    u.location_id,
    u.fname,
    u.lname,
    COUNT(CASE WHEN t.status = 'open' THEN 1 END) AS total_open_tasks,
    COUNT(CASE WHEN t.status = 'in progress' THEN 1 END) AS total_in_progress_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS total_completed_tasks
FROM 
    users u
LEFT JOIN 
    tasks t ON u.user_id = t.assigned_to AND u.company_id = t.location_id
WHERE 
    u.profile_type = 'employee'
GROUP BY 
    u.user_id, u.cognito_user_id, u.company_id, u.location_id, u.fname, u.lname;

CREATE VIEW admin_dashboard AS
SELECT 
    u.user_id,
    u.cognito_user_id,
    u.company_id,
    u.location_id,
    u.fname,
    u.lname,
    COUNT(CASE WHEN t.status = 'open' THEN 1 END) AS total_open_tasks,
    COUNT(CASE WHEN t.status = 'in progress' THEN 1 END) AS total_in_progress_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS total_completed_tasks,
    COUNT(CASE WHEN t.source = u.user_id THEN 1 END) AS tasks_created
FROM 
    users u
LEFT JOIN 
    tasks t ON (u.user_id = t.assigned_to OR u.user_id = t.source) AND u.company_id = t.location_id
WHERE 
    u.profile_type IN ('admin', 'super_admin')
GROUP BY 
    u.user_id, u.cognito_user_id, u.company_id, u.location_id, u.fname, u.lname;

-- Create a function to update the edit_timestamp when a task is modified
CREATE OR REPLACE FUNCTION update_task_edit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.edit_timestamp = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to call the function when a task is updated
CREATE TRIGGER update_task_edit_timestamp
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION update_task_edit_timestamp();

-- Create a function to log changes to the task_changes table
CREATE OR REPLACE FUNCTION log_task_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.task_title <> OLD.task_title THEN
            INSERT INTO task_changes (task_id, field_name, old_value, new_value, changed_by)
            VALUES (NEW.task_id, 'task_title', OLD.task_title, NEW.task_title, NEW.assigned_to);
        END IF;
        IF NEW.description <> OLD.description THEN
            INSERT INTO task_changes (task_id, field_name, old_value, new_value, changed_by)
            VALUES (NEW.task_id, 'description', OLD.description, NEW.description, NEW.assigned_to);
        END IF;
        IF NEW.status <> OLD.status THEN
            INSERT INTO task_changes (task_id, field_name, old_value, new_value, changed_by)
            VALUES (NEW.task_id, 'status', OLD.status, NEW.status, NEW.assigned_to);
        END IF;
        IF NEW.priority <> OLD.priority THEN
            INSERT INTO task_changes (task_id, field_name, old_value, new_value, changed_by)
            VALUES (NEW.task_id, 'priority', OLD.priority::text, NEW.priority::text, NEW.assigned_to);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to call the function when a task is updated
CREATE TRIGGER log_task_changes
AFTER UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION log_task_changes();

-- Create a function to ensure proper admin and super_admin creation
CREATE OR REPLACE FUNCTION ensure_admin_creation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.profile_type IN ('admin', 'super_admin') AND 
       (SELECT profile_type FROM users WHERE user_id = NEW.created_by) NOT IN ('admin', 'super_admin') THEN
        RAISE EXCEPTION 'Only admins or super admins can create admin accounts';
    END IF;
    IF NEW.profile_type = 'super_admin' AND 
       (SELECT profile_type FROM users WHERE user_id = NEW.created_by) != 'super_admin' THEN
        RAISE EXCEPTION 'Only super admins can create super admin accounts';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to enforce admin creation rule
CREATE TRIGGER enforce_admin_creation
BEFORE INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION ensure_admin_creation();