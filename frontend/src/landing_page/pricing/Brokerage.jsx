function Brokerage() {
  return (
    <div className="container">
      <div className="row p-5 mt-5 text-center border-top">
        <div className="col-8 p-4">
          <h3 className="fs-5">How simulated pricing works</h3>
          <ul
            style={{ textAlign: "left", lineHeight: "2.5", fontSize: "12px" }}
            className="text-mut"
          >
            <li>Stock and ETF orders are simulated at $0 commission.</li>
            <li>All balances and portfolio values are shown in USD.</li>
            <li>
              No real orders or fund transfers are submitted by this demo.
            </li>
          </ul>
        </div>
        <div className="col-4 p-4">
          <h3 className="fs-5">No charges</h3>
          <p className="text-muted">
            PaperTrade does not accept payments, deposits, or subscription fees.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Brokerage;
