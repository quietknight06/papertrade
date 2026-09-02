import Hero from "./Hero";
import LeftSection from "./LeftSection";
import RightSection from "./RightSection";
import Universe from "./Universe";

function ProductsPage() {
  return (
    <>
      <Hero />
      <LeftSection
        imageURL="media/images/alpaca.jpg"
        productName="Live watchlist"
        productDesription="Follow Alpaca IEX quotes for AAPL, MSFT, NVDA, AMZN, GOOGL, and TSLA, then start a simulated buy or sell order from the watchlist."
        tryDemo="/dashboard"
        learnMore=""
        googlePlay=""
        appStore=""
      />
      <RightSection
        imageURL="media/images/piechart.png"
        productName="Portfolio dashboard"
        productDesription="Review paper buying power, invested value, current value, profit and loss, holdings, open positions, orders, and allocation."
        learnMore="/dashboard"
      />
      <LeftSection
        imageURL="media/images/dollarsign.jpg"
        productName="Paper funds"
        productDesription="Practice deposits and withdrawals against a simulated U.S. dollar balance. No real money is accepted or transferred."
        tryDemo="/dashboard/funds"
        learnMore=""
        googlePlay=""
        appStore=""
      />
      <RightSection
        imageURL="media/images/mongoDB.webp"
        productName="Account and order API"
        productDesription="An Express API connects authentication, MongoDB-backed portfolios, paper order execution, live market quotes, and model inference."
      />
      <LeftSection
        imageURL="media/images/python2.webp"
        productName="Experimental forecasts"
        productDesription="Compare next-day price estimates with 1-, 5-, and 20-day direction probabilities and historical holdout metrics. These ML models were trained using Python libraries like Numpy, Pandas and Scikit. Forecasts do not guarantee results and are not financial advice."
        tryDemo="/dashboard"
        learnMore=""
        googlePlay=""
        appStore=""
      />
      <p className="text-center mt-5 mb-5">
        PaperTrade is an educational portfolio project, not a brokerage or
        investment service.
      </p>
      <Universe />
    </>
  );
}

export default ProductsPage;
