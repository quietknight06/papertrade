function Team() {
  return (
    <div className="container">
      <div className="row p-3 mt-5 border-top">
        <h1 className="text-center ">People</h1>
      </div>

      <div
        className="row p-3 text-muted"
        style={{ lineHeight: "1.8", fontSize: "1.2em" }}
      >
        <div className="col-6 p-3 text-center">
          <h4 className="mt-5">Vedant Venkat</h4>
          <h6>Creator of PaperTrade</h6>
        </div>
        <div className="col-6 p-3">
          <p>
            Vedant created PaperTrade as a working demonstration of full-stack
            development, market-data integration, and applied machine learning.
          </p>
          <p>
            The application supports Alpaca-tradable U.S. stocks, U.S. dollar
            paper balances, and clearly identified simulated trading. Its
            experimental forecasts remain limited to six stocks.
          </p>
          <p>
            <a
              href="https://www.linkedin.com/in/vedant-venkat-393b21252"
              target="_blank"
              rel="noreferrer"
            >
              Connect with Vedant on LinkedIn
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Team;
