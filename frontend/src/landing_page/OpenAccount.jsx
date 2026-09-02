import { Link } from "react-router-dom";

function OpenAccount() {
  return (
    <div className="container p-5 mb-5">
      <div className="row text-center">
        <h1 className="mt-5">Try the PaperTrade simulator</h1>
        <p>
          Create a project account to search Alpaca-tradable U.S. stocks, place
          simulated orders, manage paper funds, and view experimental forecasts
          for six model-supported stocks.
        </p>
        <br />
        <br />
        <br />
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

export default OpenAccount;
