import { Link } from "react-router-dom";

function Hero({ animateIntro = false }) {
  return (
    <div className="container p-5 mb-5">
      <div className="row text-center">
        <img
          src="media/images/homeHero.png"
          alt="Hero Image"
          className="mb-5"
        />
        <div className={animateIntro ? "home-hero-copy animate" : "home-hero-copy"}>
          <h1 className="mt-5">Practice trading without risking real money</h1>
          <p>
            Follow live U.S. stock quotes, place simulated orders, track a paper
            portfolio, and explore experimental machine-learning forecasts.
          </p>
          <div className="d-flex justify-content-center gap-3 flex-wrap mb-5">
            <Link to="/signup" className="p-2 btn btn-primary fs-5">
              Sign Up Now
            </Link>
            <Link to="/demo" className="p-2 btn btn-outline-primary fs-5">
              Try the Demo
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Hero;
