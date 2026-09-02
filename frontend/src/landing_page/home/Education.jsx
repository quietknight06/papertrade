import { Link } from "react-router-dom";

function Education() {
  return (
    <div className="container mt-5">
      <div className="row">
        <div className="col-6">
          <img
            src="media/images/piechart.png"
            style={{ width: "70%" }}
            alt="Learning through the PaperTrade simulator"
          />
        </div>
        <div className="col-6">
          <h1 className="mb-3 fs-2">Learn by using the simulator</h1>
          <p>
            See how quotes, order prices, buying power, holdings, positions, and
            portfolio allocation relate to one another in a working application.
          </p>
          <Link to="/products" style={{ textDecoration: "none" }}>
            Explore features{" "}
            <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          </Link>
          <p className="mt-5">
            Compare model probabilities with historical holdout metrics while
            remembering that experimental predictions do not guarantee future
            prices or investment results.
          </p>
          <Link to="/dashboard" style={{ textDecoration: "none" }}>
            View the dashboard{" "}
            <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Education;
