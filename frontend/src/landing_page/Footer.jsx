import { Link } from "react-router-dom";
import "./Footer.css";

function Footer() {
  const linkedInUrl = "https://www.linkedin.com/in/vedant-venkat-393b21252";

  return (
    <footer
      className="site-footer"
      style={{ backgroundColor: "rgb(250, 250, 250)" }}
    >
      <div className="container border-top mt-5">
        <div className="row mt-5">
          <div className="col">
            <img
              src="/media/images/logo.png"
              style={{ width: "50%" }}
              alt="PaperTrade"
            />
            <p>&copy; 2026 PaperTrade. Educational paper-trading demo.</p>
          </div>
          <div className="col">
            <p>
              <b>Company</b>
            </p>
            <Link to="/about">About</Link>
            <br />
            <Link to="/products">Products</Link>
            <br />
            <Link to="/pricing">Pricing</Link>
            <br />
            <Link to="/dashboard">Dashboard</Link>
            <br />
          </div>
          <div className="col">
            <p>
              <b>Project</b>
            </p>
            <Link to="/contact">Contact page</Link>
            <br />
            <a href={linkedInUrl} target="_blank" rel="noreferrer">
              Contact Vedant on LinkedIn
            </a>
            <br />
          </div>
          <div className="col">
            <p>
              <b>Account</b>
            </p>
            <Link to="/signup">Open an account</Link>
            <br />
            <Link to="/dashboard/funds">Fund transfer</Link>
            <br />
          </div>
        </div>
        <div className="mt-5 text-muted" style={{ fontSize: "14px" }}>
          <p>
            PaperTrade is a portfolio project and educational paper-trading
            simulator for Alpaca-tradable U.S. stocks. It is not a
            broker-dealer, investment adviser, exchange, custodian, or financial
            service. No real securities or funds are transferred.
          </p>
          <p>
            All displayed amounts are in U.S. dollars unless stated otherwise.
            Actual investing involves risk, including possible loss of
            principal. Nothing on this site is investment, tax, or legal advice.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
