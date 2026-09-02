function Hero() {
  return (
    <div className="container">
      <div className="row p-5 mt-5 mb-5">
        <h1 className="fs-2 text-center">
          A full-stack paper-trading and forecasting project
          <br />
          built to explore markets, software, and machine learning.
        </h1>
      </div>

      <div
        className="row p-5 mt-5 border-top text-muted"
        style={{ lineHeight: "1.8", fontSize: "1.2em" }}
      >
        <div className="col-6 p-5">
          <p>
            PaperTrade is an educational simulator for learning how quotes,
            orders, positions, and portfolio allocation work for Alpaca-tradable
            U.S. stocks.
          </p>
          <p>
            The project combines a React dashboard, an Express API, MongoDB
            persistence, Alpaca market data, and Python machine-learning models.
          </p>
          <p>
            Simulated balances and orders let learners explore workflows without
            transmitting real orders or funds.
          </p>
        </div>
        <div className="col-6 p-5">
          <p>
            The dashboard provides paper cash management, simulated order
            execution, holdings and positions, portfolio allocation, and order
            history.
          </p>
          <p>
            The forecasting panel combines a next-day price model with 1-, 5-,
            and 20-day direction models. These estimates are experimental, do
            not guarantee results, and are not financial advice. These were
            trained using using Python libraries with data from Tiingo. The
            price model is based on recent logarithmic price changes and the
            directions model is based on{" "}
            <a
              href="https://arxiv.org/pdf/1605.00003"
              target="_blank"
              rel="noopener noreferrer"
            >
              this
            </a>{" "}
            paper from Khaidem et al, called "Predicting the direction of stock
            market prices using random forest".
          </p>
          <p>
            Learn more about the developer, Vedant Venkat, on{" "}
            <a
              href="https://www.linkedin.com/in/vedant-venkat-393b21252"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              LinkedIn
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export default Hero;
