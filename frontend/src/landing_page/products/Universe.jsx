import { Link } from "react-router-dom";

function Universe() {
  return (
    <div className="container mt-5">
      <div className="row text-center">
        <h1>Market and forecast coverage</h1>
        <p>
          Search active, tradable U.S. equities from the connected Alpaca
          account for live quotes and simulated orders. Experimental ML
          prediction models, trained using Python libraries, currently cover the
          six companies below.
        </p>
        {["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA"].map((symbol) => (
          <div className="col-4 p-3 mt-4" key={symbol}>
            <h2 className="fs-4">{symbol}</h2>
            <p className="text-small text-muted">Experimental model coverage</p>
          </div>
        ))}
        <Link
          to="/signup"
          className="p-2 btn btn-primary fs-5 mb-5"
          style={{ width: "20%", margin: "0 auto" }}
        >
          Sign up now
        </Link>
      </div>
    </div>
  );
}

export default Universe;
