from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from config.settings import DATABASE_URL

Base = declarative_base()
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Stock(Base):
    __tablename__ = 'stocks'

    id = Column(Integer, primary_key=True)
    symbol = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    price = Column(Float)
    change = Column(Float)
    change_percent = Column(Float)
    volume = Column(String)
    market_cap = Column(String)
    updated_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

class ChartData(Base):
    __tablename__ = 'chart_data'

    id = Column(Integer, primary_key=True)
    symbol = Column(String, nullable=False)
    time = Column(String)
    price = Column(Float)
    volume = Column(Integer)
    timestamp = Column(DateTime, default=datetime.utcnow)

def get_db():
    db = SessionLocal()
    try:
        return db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
