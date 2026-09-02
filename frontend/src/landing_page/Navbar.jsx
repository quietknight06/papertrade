import { NavLink } from "react-router-dom";

function Navbar() {
  return (
    <nav
      className="navbar navbar-expand-lg border-bottom"
      style={{ backgroundColor: "#FFF" }}
    >
      <div className="container p-2">
        <NavLink className="navbar-brand" to="/">
          <img
            src="/media/images/logo.png"
            style={{ width: "25%" }}
            alt="Logo"
          />
        </NavLink>
        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarSupportedContent"
          aria-controls="navbarSupportedContent"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarSupportedContent">
          <div className="d-flex ms-auto">
            <ul className="navbar-nav mb-lg-0">
              {[
                ["/dashboard", "Dashboard"],
                ["/about", "About"],
                ["/products", "Products"],
                ["/pricing", "Pricing"],
                ["/contact", "Contact"],
                ["/signup", "Sign Up"],
              ].map(([to, label]) => (
                <li className="nav-item" key={to}>
                  <NavLink className="nav-link" to={to}>
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
