from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.config import config
from src.data.clients.base_class import Base
from src.data.models.postgres.bill import Bill, BillItem

engine = create_engine(
    config.DATABASE_URL,
    future=True,
    pool_pre_ping=True,
    pool_size=config.DATABASE_POOL_SIZE,
    max_overflow=config.DATABASE_MAX_OVERFLOW,
    pool_recycle=config.DATABASE_POOL_RECYCLE_SECONDS,
    connect_args={"prepare_threshold": None},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    # Ensure all model tables are registered on metadata before create_all.
    import src.data.models.postgres  # noqa: F401
    from sqlalchemy import text

    with engine.begin() as conn:
        # Check if tables are already created to avoid 70s+ redundant catalog inspections over remote pooler
        tables_exist = conn.execute(text("SELECT to_regclass('public.users')")).scalar()
        if not tables_exist:
            Base.metadata.create_all(bind=conn)

        # Safe column migrations and table creations for existing databases (batched for speed)
        migrations_sql = """
        ALTER TABLE material_master ADD COLUMN IF NOT EXISTS has_bundle_conversion BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE material_master ADD COLUMN IF NOT EXISTS default_bundle_weight NUMERIC(12, 2) NOT NULL DEFAULT 0;
        ALTER TABLE material_master ADD COLUMN IF NOT EXISTS supplier VARCHAR(120) NOT NULL DEFAULT '';
        ALTER TABLE material_logs ADD COLUMN IF NOT EXISTS bill_no VARCHAR(100);
        ALTER TABLE workers ADD COLUMN IF NOT EXISTS wage_options JSON NOT NULL DEFAULT '[]';

        CREATE TABLE IF NOT EXISTS office_settlements (
            id SERIAL PRIMARY KEY,
            amount NUMERIC(12, 2) NOT NULL,
            date DATE NOT NULL,
            payment_mode VARCHAR(50),
            notes TEXT,
            created_by_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS site_expenses (
            id SERIAL PRIMARY KEY,
            item_name VARCHAR(120),
            category VARCHAR(80) NOT NULL,
            amount NUMERIC(12, 2) NOT NULL,
            rate NUMERIC(12, 2),
            quantity NUMERIC(12, 3),
            description TEXT,
            bill_url VARCHAR(500),
            date DATE NOT NULL,
            week_start DATE NOT NULL,
            closed_at TIMESTAMP WITH TIME ZONE,
            allocation VARCHAR(20) NOT NULL DEFAULT 'other',
            project_id INTEGER REFERENCES projects(id),
            created_by_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE site_expenses ADD COLUMN IF NOT EXISTS allocation VARCHAR(20) NOT NULL DEFAULT 'other';
        ALTER TABLE site_expenses ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);

        CREATE TABLE IF NOT EXISTS site_settlements (
            id SERIAL PRIMARY KEY,
            amount NUMERIC(12, 2) NOT NULL,
            date DATE NOT NULL,
            payment_mode VARCHAR(50),
            notes TEXT,
            created_by_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;
        ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_name VARCHAR(120);
        ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_email VARCHAR(255);
        ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details TEXT;

        ALTER TABLE project_shareholders ADD COLUMN IF NOT EXISTS city VARCHAR(120);
        ALTER TABLE project_shareholders ADD COLUMN IF NOT EXISTS pincode VARCHAR(12);

        ALTER TABLE bills ALTER COLUMN project_id DROP NOT NULL;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS custom_project_name VARCHAR(150);
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12, 2) DEFAULT 0;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12, 2) DEFAULT 0;

        ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50) DEFAULT '995411';
        ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(5, 2) DEFAULT 2.5;
        ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(5, 2) DEFAULT 2.5;
        ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12, 2) DEFAULT 0;
        ALTER TABLE bill_items ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12, 2) DEFAULT 0;

        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_composite_value_per_sqft NUMERIC(12, 2) NOT NULL DEFAULT 0;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_land_factor NUMERIC(8, 4) NOT NULL DEFAULT 1;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_gst_percent NUMERIC(6, 2) NOT NULL DEFAULT 5;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_registration_value_percent NUMERIC(6, 2) NOT NULL DEFAULT 4;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_construction_cost_per_sqft NUMERIC(12, 2) NOT NULL DEFAULT 0;

        ALTER TABLE project_shareholders ADD COLUMN IF NOT EXISTS legal_charges NUMERIC(12, 2) NOT NULL DEFAULT 0;
        ALTER TABLE shareholder_payments ADD COLUMN IF NOT EXISTS purpose VARCHAR(30) NOT NULL DEFAULT 'construction';
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS gst_only BOOLEAN NOT NULL DEFAULT FALSE;

        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_slab1_upto NUMERIC(14, 2) NOT NULL DEFAULT 5000000;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_slab2_upto NUMERIC(14, 2) NOT NULL DEFAULT 30000000;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_slab1_gst_percent NUMERIC(6, 2) NOT NULL DEFAULT 6;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_slab2_gst_percent NUMERIC(6, 2) NOT NULL DEFAULT 7;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_slab1_registration_percent NUMERIC(6, 2) NOT NULL DEFAULT 6;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_slab2_registration_percent NUMERIC(6, 2) NOT NULL DEFAULT 7;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_legal_charges NUMERIC(12, 2) NOT NULL DEFAULT 0;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_gst_percent NUMERIC(6, 2) NOT NULL DEFAULT 5;
        ALTER TABLE projects ALTER COLUMN govt_new_gst_percent SET DEFAULT 5;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_reg_upto_50l_percent NUMERIC(6, 2) NOT NULL DEFAULT 6;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_reg_upto_3cr_percent NUMERIC(6, 2) NOT NULL DEFAULT 7;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS govt_new_reg_above_3cr_percent NUMERIC(6, 2) NOT NULL DEFAULT 9;

        CREATE TABLE IF NOT EXISTS labour_incharge_limits (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            vendor_id INTEGER NOT NULL REFERENCES vendor_master(id) ON DELETE CASCADE,
            limit_amount NUMERIC(12, 2) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uq_labour_incharge_limits_project_vendor UNIQUE (project_id, vendor_id)
        );
        CREATE INDEX IF NOT EXISTS ix_labour_incharge_limits_project_id ON labour_incharge_limits (project_id);
        CREATE INDEX IF NOT EXISTS ix_labour_incharge_limits_vendor_id ON labour_incharge_limits (vendor_id);
        """

        conn.execute(text(migrations_sql))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
