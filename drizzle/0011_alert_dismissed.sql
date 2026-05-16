ALTER TABLE alerts MODIFY COLUMN status 
  ENUM('active','acknowledged','resolved','dismissed') 
  DEFAULT 'active' NOT NULL;
