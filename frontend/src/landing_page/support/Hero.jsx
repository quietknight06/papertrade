function Hero() {
  const linkedInUrl = "https://www.linkedin.com/in/vedant-venkat-393b21252";

  return (
    <section className="container-fluid" id="supportHero">
      <div className="p-5 " id="supportWrapper">
        <h4>Contact the creator of PaperTrade</h4>
        <a href={linkedInUrl} target="_blank" rel="noreferrer">
          LinkedIn profile
        </a>
      </div>
      <div className="row p-5 m-3">
        <div className="col-6 p-3">
          <h1 className="fs-3">Contact Vedant</h1>
          <p>
            PaperTrade was designed and developed by me as a full-stack
            portfolio project combining web development, market data, simulated
            trading, and machine learning.
          </p>
          <a
            className="btn btn-primary"
            href={linkedInUrl}
            target="_blank"
            rel="noreferrer"
          >
            Connect on LinkedIn
          </a>
        </div>
        <div className="col-6 p-3">
          <h1 className="fs-3">About PaperTrade</h1>
          <ul>
            <li>React dashboard with an Express API and MongoDB persistence</li>
            <li>Alpaca IEX quotes and simulated order execution</li>
            <li>Experimental price and direction forecasting models</li>
          </ul>
          <p>
            The site is for recreational use only and is not a brokerage,
            investment service, or source of financial advice.
          </p>
        </div>
      </div>
    </section>
  );
}

export default Hero;
