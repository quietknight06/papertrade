function Awards() {
  return (
    <div className="container mt-5">
      <div className="row">
        <div className="col-6 p-5">
          <br />
          <br />
          <br />
          <br />
          <img
            src="media/images/AwardsImage.png"
            alt="PaperTrade dashboard overview"
            width="300vh"
            height="300vh"
          />
        </div>
        <div className="col-6 p-5 mt-5">
          <h1>A focused paper-trading dashboard</h1>
          <p className="mb-5">
            PaperTrade brings the core parts of the project together in one
            account-based experience:
          </p>
          <div className="row">
            <div className="col-6">
              <ul>
                <li>
                  <p>Real-time Alpaca IEX quotes</p>
                </li>
                <li>
                  <p>Searchable U.S. stock catalog</p>
                </li>
                <li>
                  <p>Simulated USD balances</p>
                </li>
              </ul>
            </div>
            <div className="col-6">
              <ul>
                <li>
                  <p>Buy and sell orders</p>
                  <br />
                </li>
                <li>
                  <p>Portfolio allocation</p>
                  <br />
                </li>
                <li>
                  <p>Experimental ML forecasts</p>
                  <br />
                </li>
              </ul>
            </div>
          </div>
          <p className="text-muted mt-4">
            No real securities, brokerage accounts, or funds are involved.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Awards;
