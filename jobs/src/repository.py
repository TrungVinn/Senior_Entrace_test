from dagster import job, op, Definitions

@op
def compute_portfolio():
    # Placeholder for portfolio_calculator
    pass

@job
def portfolio_job():
    compute_portfolio()

defs = Definitions(
    jobs=[portfolio_job]
)
