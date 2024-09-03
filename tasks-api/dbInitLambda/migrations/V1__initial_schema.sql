-- Combined schema for task management system

-- Create Companies table
CREATE TABLE companies (
    company_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    logo_url VARCHAR(255),
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

-- Create Users table
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    cognito_user_id VARCHAR(255) UNIQUE NOT NULL,
    profile_type VARCHAR(20) NOT NULL CHECK (profile_type IN ('super_admin', 'admin', 'employee')),
    creation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fname VARCHAR(50) NOT NULL,
    lname VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(user_id),
    company_id INTEGER REFERENCES companies(company_id)
);

-- Create user_locations junction table
CREATE TABLE user_locations (
    user_id INTEGER NOT NULL REFERENCES users(user_id),
    location_id INTEGER NOT NULL REFERENCES locations(location_id),
    PRIMARY KEY (user_id, location_id)
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
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_location_id ON tasks(location_id);
CREATE INDEX idx_tasks_source ON tasks(source);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_locations_company_id ON locations(company_id);
CREATE INDEX idx_user_locations_user_id ON user_locations(user_id);
CREATE INDEX idx_user_locations_location_id ON user_locations(location_id);

-- Create updated views for dashboard queries
CREATE OR REPLACE VIEW employee_dashboard AS
SELECT 
    u.user_id,
    u.fname,
    u.lname,
    c.name AS company_name,
    array_agg(DISTINCT l.name) AS location_names,
    COUNT(CASE WHEN t.status = 'open' THEN 1 END) AS total_open_tasks,
    COUNT(CASE WHEN t.status = 'in progress' THEN 1 END) AS total_in_progress_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS total_completed_tasks
FROM 
    users u
JOIN
    companies c ON u.company_id = c.company_id
JOIN
    user_locations ul ON u.user_id = ul.user_id
JOIN
    locations l ON ul.location_id = l.location_id
LEFT JOIN 
    tasks t ON u.user_id = t.assigned_to AND t.location_id = ul.location_id
WHERE 
    u.profile_type = 'employee'
GROUP BY 
    u.user_id, u.fname, u.lname, c.name;

CREATE OR REPLACE VIEW admin_dashboard AS
SELECT 
    u.user_id,
    u.fname,
    u.lname,
    c.name AS company_name,
    array_agg(DISTINCT l.name) AS location_names,
    COUNT(CASE WHEN t.status = 'open' THEN 1 END) AS total_open_tasks,
    COUNT(CASE WHEN t.status = 'in progress' THEN 1 END) AS total_in_progress_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS total_completed_tasks,
    COUNT(CASE WHEN t.source = u.user_id THEN 1 END) AS tasks_created
FROM 
    users u
JOIN
    companies c ON u.company_id = c.company_id
JOIN
    user_locations ul ON u.user_id = ul.user_id
JOIN
    locations l ON ul.location_id = l.location_id
LEFT JOIN 
    tasks t ON (u.user_id = t.assigned_to OR u.user_id = t.source) AND t.location_id = ul.location_id
WHERE 
    u.profile_type IN ('admin', 'super_admin')
GROUP BY 
    u.user_id, u.fname, u.lname, c.name;

-- New view for pooled tasks
CREATE OR REPLACE VIEW pooled_tasks AS
SELECT 
    t.*,
    l.name AS location_name,
    c.name AS company_name
FROM 
    tasks t
JOIN
    locations l ON t.location_id = l.location_id
JOIN
    companies c ON l.company_id = c.company_id
WHERE 
    t.is_pooled = TRUE AND t.status != 'completed';

-- New view for super admin insights across all companies
CREATE OR REPLACE VIEW super_admin_dashboard AS
SELECT 
    c.company_id,
    c.name AS company_name,
    COUNT(DISTINCT u.user_id) AS total_users,
    COUNT(DISTINCT l.location_id) AS total_locations,
    COUNT(CASE WHEN t.status = 'open' THEN 1 END) AS total_open_tasks,
    COUNT(CASE WHEN t.status = 'in progress' THEN 1 END) AS total_in_progress_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS total_completed_tasks
FROM 
    companies c
LEFT JOIN
    users u ON c.company_id = u.company_id
LEFT JOIN
    locations l ON c.company_id = l.company_id
LEFT JOIN
    tasks t ON l.location_id = t.location_id
GROUP BY 
    c.company_id, c.name;

-- Function to check if the assigned user is from the same company as the task's location
CREATE OR REPLACE FUNCTION check_task_assignment(p_assigned_to INTEGER, p_location_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_company_id INTEGER;
    v_location_company_id INTEGER;
BEGIN
    -- Get the company ID of the assigned user
    SELECT company_id INTO v_user_company_id
    FROM users
    WHERE user_id = p_assigned_to;

    -- Get the company ID of the task's location
    SELECT company_id INTO v_location_company_id
    FROM locations
    WHERE location_id = p_location_id;

    -- Return true if the company IDs match or if the task is not assigned (p_assigned_to is NULL)
    RETURN (p_assigned_to IS NULL) OR (v_user_company_id = v_location_company_id);
END;
$$ LANGUAGE plpgsql;

-- Add constraint to ensure tasks are only assigned within the same company
ALTER TABLE tasks
ADD CONSTRAINT task_same_company_check
CHECK (check_task_assignment(assigned_to, location_id));

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

-- Updated function to ensure proper user creation based on roles
CREATE OR REPLACE FUNCTION ensure_proper_user_creation()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the user being created has a valid created_by user
    IF NEW.created_by IS NOT NULL THEN
        -- Super admin creation
        IF NEW.profile_type = 'super_admin' AND 
           (SELECT profile_type FROM users WHERE user_id = NEW.created_by) != 'super_admin' THEN
            RAISE EXCEPTION 'Only super admins can create super admin accounts';
        END IF;

        -- Admin creation
        IF NEW.profile_type = 'admin' AND 
           (SELECT profile_type FROM users WHERE user_id = NEW.created_by) NOT IN ('admin', 'super_admin') THEN
            RAISE EXCEPTION 'Only admins or super admins can create admin accounts';
        END IF;

        -- Employee creation
        IF NEW.profile_type = 'employee' AND 
           (SELECT profile_type FROM users WHERE user_id = NEW.created_by) NOT IN ('admin', 'super_admin') THEN
            RAISE EXCEPTION 'Only admins or super admins can create employee accounts';
        END IF;

        -- Ensure users are created within the same company as their creator
        IF (SELECT company_id FROM users WHERE user_id = NEW.created_by) != NEW.company_id THEN
            RAISE EXCEPTION 'Users can only be created within the same company as their creator';
        END IF;
    ELSE
        -- If created_by is NULL, it might be the first super_admin being created
        IF NEW.profile_type != 'super_admin' THEN
            RAISE EXCEPTION 'The first user must be a super_admin';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to enforce proper user creation rules
DROP TRIGGER IF EXISTS enforce_admin_creation ON users;
CREATE TRIGGER enforce_proper_user_creation
BEFORE INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION ensure_proper_user_creation();