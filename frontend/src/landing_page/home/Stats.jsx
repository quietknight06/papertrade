import { Link } from "react-router-dom";

function Stats() {
  return (
    <div className="container p-3">
      <div className="row p-5">
        <div className="col-6 p-5">
          <h1 className="fs-2 mb-5">A working full-stack project</h1>
          <h2 className="fs-4">Persistent paper-trading accounts</h2>
          <p className="text-muted">
            Create an account, sign in, and keep simulated cash, holdings, and
            orders in MongoDB.
          </p>
          <h2 className="fs-4">Market-aware order simulation</h2>
          <p className="text-muted">
            Compare orders with current Alpaca IEX quotes and see marketable
            orders fill in the paper portfolio.
          </p>
          <h2 className="fs-4">Portfolio visibility</h2>
          <p className="text-muted">
            Review buying power, invested value, profit and loss, holdings, open
            positions, order history, and allocation.
          </p>
          <h2 className="fs-4">Experimental forecasting</h2>
          <p className="text-muted">
            Inspect next-day price estimates and 1-, 5-, and 20-day direction
            probabilities. These experimental models do not guarantee results
            and are not financial advice.
          </p>
        </div>
        <div className="col-6 p-5">
          <img src="media/images/fullstack.avif" style={{ width: "90%" }} />
          <br />
          <br />
          <br />
          <br />
          <br />
          <br />
          <div className="text-center">
            <Link
              to="/products"
              className="mx-5"
              style={{ textDecoration: "none" }}
            >
              Explore features{" "}
              <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
            </Link>
            <br />
            <br />
            <br />
            <br />
            <br />
            <br />
            <Link to="/dashboard" style={{ textDecoration: "none" }}>
              Open dashboard{" "}
              <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Stats;
