import json
import os
from datetime import date, datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Float, Text, Date, Boolean,
    ForeignKey, text
)
from sqlalchemy.orm import declarative_base, relationship, scoped_session, sessionmaker
from werkzeug.security import generate_password_hash, check_password_hash

Base = declarative_base()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Firm(Base):
    __tablename__ = 'firms'

    id       = Column(Integer, primary_key=True)          # 1, 2, 3
    name     = Column(String(200), nullable=False)
    location = Column(String(300), default='')
    phone    = Column(String(30), default='')

    def to_dict(self):
        return {'id': self.id, 'name': self.name, 'location': self.location, 'phone': self.phone}


class Product(Base):
    """One row per (firm_id, size_id) pair. size_id is the display key ('12kg')."""
    __tablename__ = 'products'

    id      = Column(Integer, primary_key=True, autoincrement=True)
    firm_id = Column(Integer, ForeignKey('firms.id'), nullable=False)
    size_id = Column(String(50), nullable=False)   # e.g. '12kg'
    label   = Column(String(100), nullable=False)  # e.g. '12kg Domestic'
    price   = Column(Float, nullable=False, default=0.0)
    active  = Column(Boolean, default=True)

    stock   = relationship('Stock', back_populates='product', uselist=False,
                           cascade='all, delete-orphan')
    history = relationship('ProductHistory', back_populates='product',
                           cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id':      self.id,
            'firm_id': self.firm_id,
            'size_id': self.size_id,
            'label':   self.label,
            'price':   self.price,
            'active':  self.active,
        }


class Stock(Base):
    __tablename__ = 'stocks'

    id          = Column(Integer, primary_key=True, autoincrement=True)
    product_id  = Column(Integer, ForeignKey('products.id'), nullable=False, unique=True)
    filled_qty  = Column(Integer, nullable=False, default=0)
    empty_qty   = Column(Integer, nullable=False, default=0)
    pending_qty = Column(Integer, nullable=False, default=0)  # empties sent out, awaiting return as filled

    product = relationship('Product', back_populates='stock')

    def to_dict(self):
        return {
            'product_id': self.product_id,
            'filled_qty': self.filled_qty,
            'empty_qty':  self.empty_qty,
            'pending_qty': self.pending_qty,
        }


class Customer(Base):
    __tablename__ = 'customers'

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    firm_id             = Column(Integer, ForeignKey('firms.id'), nullable=False)
    name                = Column(String(200), nullable=False)
    phone               = Column(String(30), default='')
    address             = Column(Text, default='')
    # JSON list: [{"sizeId": "12kg", "limit": 2}, ...]
    plans               = Column(Text, nullable=False, default='[]')
    last_plan_change_date = Column(Date, nullable=True)
    active              = Column(Boolean, default=True)

    transactions = relationship('Transaction', back_populates='customer')

    def get_plans(self):
        return json.loads(self.plans or '[]')

    def set_plans(self, plans_list):
        self.plans = json.dumps(plans_list)

    def to_dict(self):
        return {
            'id':                 self.id,
            'firm_id':            self.firm_id,
            'name':               self.name,
            'phone':              self.phone,
            'address':            self.address,
            'plans':              self.get_plans(),
            'lastPlanChangeDate': self.last_plan_change_date.isoformat()
                                  if self.last_plan_change_date else None,
            'active':             self.active,
        }


class Transaction(Base):
    __tablename__ = 'transactions'

    id          = Column(Integer, primary_key=True, autoincrement=True)
    firm_id     = Column(Integer, ForeignKey('firms.id'), nullable=False)
    customer_id = Column(Integer, ForeignKey('customers.id'), nullable=True)
    date        = Column(Date, nullable=False, default=date.today)
    created_at  = Column(String(30), default='')
    # JSON list: [{"type": "12kg", "filled": 2, "empty": 0,
    #              "dueDate": "2026-03-20", "returnedDate": ""}]
    items       = Column(Text, nullable=False, default='[]')
    total       = Column(Float, nullable=False, default=0.0)
    status      = Column(String(20), nullable=False, default='Pending')

    customer = relationship('Customer', back_populates='transactions')

    def get_items(self):
        return json.loads(self.items or '[]')

    def set_items(self, items_list):
        self.items = json.dumps(items_list)

    def to_dict(self):
        return {
            'id':         self.id,
            'firm_id':    self.firm_id,
            'customerId': self.customer_id,
            'date':       self.date.isoformat() if self.date else '',
            'created_at': self.created_at or '',
            'items':      self.get_items(),
            'total':      self.total,
            'status':     self.status,
        }


class InventoryLog(Base):
    __tablename__ = 'inventory_logs'

    id         = Column(Integer, primary_key=True, autoincrement=True)
    firm_id    = Column(Integer, ForeignKey('firms.id'), nullable=False)
    date       = Column(Date, nullable=False, default=date.today)
    created_at = Column(String(30), default='')
    log_type   = Column(String(5), nullable=False)   # 'IN' or 'OUT'
    vehicle    = Column(String(100), default='')
    # JSON dict: {"12kg": 5, "15kg": 3}  (keyed by size_id)
    items    = Column(Text, nullable=False, default='{}')

    def get_items(self):
        return json.loads(self.items or '{}')

    def set_items(self, items_dict):
        self.items = json.dumps(items_dict)

    def to_dict(self):
        return {
            'id':      self.id,
            'firm_id': self.firm_id,
            'date':       self.date.isoformat() if self.date else '',
            'created_at': self.created_at or '',
            'type':       self.log_type,
            'vehicle': self.vehicle or '',
            'items':   self.get_items(),
        }


class ProductHistory(Base):
    __tablename__ = 'product_history'

    id         = Column(Integer, primary_key=True, autoincrement=True)
    product_id = Column(Integer, ForeignKey('products.id'), nullable=False)
    firm_id    = Column(Integer, ForeignKey('firms.id'), nullable=False)
    date       = Column(Date, nullable=False, default=date.today)
    created_at = Column(String(30), default='')
    action     = Column(String(100), nullable=False)
    details    = Column(Text, default='')

    product = relationship('Product', back_populates='history')

    def to_dict(self):
        return {
            'id':         self.id,
            'productId':  self.product_id,
            'firm_id':    self.firm_id,
            'date':       self.date.isoformat() if self.date else '',
            'created_at': self.created_at or '',
            'action':     self.action,
            'details':    self.details or '',
        }


class User(Base):
    __tablename__ = 'users'

    id            = Column(Integer, primary_key=True, autoincrement=True)
    username      = Column(String(100), nullable=False, unique=True)
    password_hash = Column(String(256), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


# ---------------------------------------------------------------------------
# Database setup & seeding
# ---------------------------------------------------------------------------

FIRM_SEEDS = [
    {'id': 1, 'name': 'Kalaimagal Gas Agencies',  'location': 'Avinashi Road, Tirupur - 641602', 'phone': '9600910225'},
    {'id': 2, 'name': 'Kalaimagal Gas Services',  'location': 'Avinashi Hub',                    'phone': '9600910225'},
    {'id': 3, 'name': 'Kalaimagal Gas Services',  'location': 'Annur Hub',                        'phone': '9600910225'},
]

DEFAULT_PRODUCTS = [
    {'size_id': '12kg',   'label': '12kg Domestic',   'price': 25.00},
    {'size_id': '15kg',   'label': '15kg Commercial',  'price': 35.00},
    {'size_id': '17kg',   'label': '17kg Industrial',  'price': 42.00},
    {'size_id': '21kg',   'label': '21kg Heavy Duty',  'price': 55.00},
]


def init_db(db_path=None):
    import os
    if db_path is None:
        db_path = os.environ.get('DB_PATH', 'gastrack.db')
    engine = create_engine(
        f'sqlite:///{db_path}',
        connect_args={'check_same_thread': False},
    )
    Base.metadata.create_all(engine)

    # Migrations: add new columns to existing databases
    migrations = [
        'ALTER TABLE stocks ADD COLUMN pending_qty INTEGER NOT NULL DEFAULT 0',
        "ALTER TABLE transactions ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE inventory_logs ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE product_history ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # Column already exists

    session_factory = sessionmaker(bind=engine)
    Session = scoped_session(session_factory)
    return engine, Session


def seed_db(Session):
    """Seed firms and default products if the DB is empty."""
    session = Session()
    try:
        for f_data in FIRM_SEEDS:
            if not session.get(Firm, f_data['id']):
                session.add(Firm(**f_data))
        session.flush()

        for firm_id in [1, 2, 3]:
            for p_data in DEFAULT_PRODUCTS:
                exists = (session.query(Product)
                          .filter_by(firm_id=firm_id, size_id=p_data['size_id'])
                          .first())
                if not exists:
                    p = Product(firm_id=firm_id, **p_data)
                    session.add(p)
                    session.flush()
                    session.add(Stock(product_id=p.id, filled_qty=0, empty_qty=0))
                    session.add(ProductHistory(
                        product_id=p.id, firm_id=firm_id,
                        date=date.today(), action='Created',
                        details=f'Initial Price: ₹{p_data["price"]}'
                    ))
        # Seed default admin user
        admin_username = os.environ.get('ADMIN_USERNAME', 'admin')
        admin_password = os.environ.get('ADMIN_PASSWORD', 'admin123')
        if not session.query(User).filter_by(username=admin_username).first():
            u = User(username=admin_username)
            u.set_password(admin_password)
            session.add(u)

        session.commit()
    finally:
        Session.remove()
