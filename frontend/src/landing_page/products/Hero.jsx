import { Link } from "react-router-dom";

function Hero() {
  return (
    <div className="container border-bottom mb-5">
      <div className="text-center mt-5 p-3">
        <h1>Project features</h1>
        <h3 className="text-muted mt-3 fs-4">
          A connected React, Express, MongoDB, market-data, and ML experience
        </h3>
        <p className="mt-3 mb-5">
          Explore the{" "}
          <Link to="/dashboard" style={{ textDecoration: "none" }}>
            paper-trading dashboard{" "}
            <i className="fa fa-long-arrow-right" aria-hidden="true"></i>
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Hero;
