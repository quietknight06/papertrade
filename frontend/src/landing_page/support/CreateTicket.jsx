const topics = [
  ["Accounts", "Project signup and MongoDB-backed sign-in"],
  ["Orders", "Simulated buy and sell order workflows"],
  ["Portfolio", "Holdings, positions, allocation, and paper performance"],
  ["Market data", "Searchable Alpaca IEX quotes for tradable U.S. stocks"],
  ["Funds", "Simulated balances, deposits, and withdrawals"],
  ["Forecasts", "Experimental price and direction predictions"],
];

function CreateTicket() {
  const linkedInUrl = "https://www.linkedin.com/in/vedant-venkat-393b21252";

  return (
    <div className="container">
      <div className="row p-5 mt-5 mb-5">
        <h1 className="fs-2">What this demo includes</h1>
        {topics.map(([title, description]) => (
          <div className="col-md-4 p-4 mt-2 mb-2" key={title}>
            <h4><i className="fa fa-question-circle" aria-hidden="true"></i> {title}</h4>
            <p className="text-muted">{description}</p>
            <a
              href={linkedInUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "none" }}
            >
              Contact Vedant on LinkedIn
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CreateTicket;
