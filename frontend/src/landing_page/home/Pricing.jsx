import { Link } from "react-router-dom";

function Pricing() {
  return (
    <div className="container">
      <div className="row">
        <div className="col-4 home-pricing-copy">
          <h1 className="mb-3 fs-2">Free to explore</h1>
          <p>
            This portfolio project does not process payments or charge
            commissions. Every balance and transaction is simulated.
          </p>
          <Link to="/pricing" style={{ textDecoration: "none" }}>
            See what is included{" "}
            <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          </Link>
        </div>
        <div className="col-2"></div>
        <div className="col-6  mb-5">
          <div className="row text-center">
            <div className="col p-3 border">
              <h1 className="mb-3">$0</h1>
              <p>
                Paper stock orders
                <br />
                with simulated funds
              </p>
            </div>
            <div className="col p-3 border">
              <h1 className="mb-3">$0</h1>
              <p>Experimental price and direction forecasts</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Pricing;
