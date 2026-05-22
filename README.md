# CS178 Final Project

An interactive data visualization project built for CS178. This project explores patterns in the dataset through multiple coordinated charts and graphs, with preprocessing steps that transform the raw data into chart-ready summaries.

## Overview

The project visualizes the dataset through several views that help users compare distributions, trends, and relationships across variables. Before rendering, the data is cleaned, filtered, aggregated, and reshaped so each visualization receives only the values it needs.

## Features

- Interactive charts and graphs for exploring the dataset
- Precomputed summary statistics for efficient rendering
- Data filtering and grouping by relevant categories
- Chart-specific transformations for clearer comparison
- Responsive visual layout for presenting the final analysis

## Data Processing

Before the data is displayed, the project performs several preprocessing steps:

- Loads the raw dataset into the visualization environment
- Parses numeric and categorical fields into usable formats
- Filters out incomplete or invalid records when needed
- Groups records by chart-specific categories
- Computes aggregate values such as counts, totals, averages, or percentages
- Sorts categories or time periods for consistent visual ordering
- Reshapes data into the structure expected by each graph
- Creates derived values used for scales, labels, tooltips, and encodings

These precomputations make the visualizations easier to read and improve performance by avoiding repeated calculations during rendering.

## Visualizations

The project includes multiple charts that each focus on a different aspect of the data. Together, they support comparison across categories, identification of trends, and exploration of relationships between variables.

## Technologies Used

- HTML
- CSS
- JavaScript
- D3.js

## Running the Project

Clone the repository:

```bash
git clone <repo-url>
cd cs178-final
Open the project locally. If it is a static site, you can open index.html directly in a browser.
```

If the project uses a local server, run:

python3 -m http.server
Then visit:

http://localhost:8000

## Project Structure
.
├── index.html
├── style.css
├── script.js
├── data/
└── README.md

Created for CS178.
