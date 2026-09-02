function Hero() {
  return (
    <div className="container">
      <div className="row p-5 mt-5 border-bottom text-center">
        <h1>Pricing</h1>
        <h3 className="text-muted mt-3 fs-5">
          Every feature is free because every trade and balance is simulated
        </h3>
      </div>
      <div className="row p-5 mt-5 text-center">
        <div className="col-4 p-4">
          <img src="media/images/zero.png" width="300vh" height="250vh" />
          <h1 className="fs-3">Experimental stock predictor</h1>
          <p className="text-muted">
            View next-day price estimates and 1-, 5-, and 20-day direction
            probabilities. These models are experimental and do not guarantee results.
          </p>
        </div>
        <div className="col-4 p-4">
          <img src="media/images/zero.png" width="300vh" height="250vh" />
          <h1 className="fs-3">Commission-free equities</h1>
          <p className="text-muted">
            Search active Alpaca-tradable U.S. stocks and place simulated
            orders. No real brokerage transaction or commission is involved.
          </p>
        </div>
        <div className="col-4 p-4">
          <img src="media/images/zero.png" width="300vh" height="250vh" />
          <h1 className="fs-3">Portfolio tools</h1>
          <p className="text-muted">
            Track holdings, positions, orders, and allocation at no cost!
          </p>
        </div>
      </div>
    </div>
  );
}

export default Hero;
