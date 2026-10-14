import { Component } from "react";

// A failed lazy chunk or renderer update must never strand someone in a match.
export default class ThreeBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("KING 3D failed", error);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="king-three">
          <div className="king-three-error" role="alert">
            <p>3D ვერ ჩაიტვირთა. თამაში შეგიძლია 2D რეჟიმში გააგრძელო.</p>
            <button onClick={this.props.onExit}>2D რეჟიმში დაბრუნება</button>
          </div>
        </div>
      );
    return this.props.children;
  }
}
