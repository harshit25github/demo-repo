import streamlit as st
import requests
from db_config import get_connection

st.set_page_config(page_title="Arcancellation Chatbot", layout="wide")

st.title("🤖 Arcancellation Data Chatbot")
st.write("Ask questions like: *Please share yesterday’s data and success percentage*")

user_question = st.text_input("Enter your question:")

if st.button("Ask"):
    with st.spinner("Thinking..."):
        # Generate SQL using LLaMA
        prompt = f"""
        Convert this question into a SQL Server SELECT query:
        Table: arcancellation
        Columns: bookDate, bookingNumber, airlineName, gdsEngine, fromTo, departureDate, portal, ticketValue, botStatus, tidStatus, remarks, botActionTime

        Question: {user_question}
        SQL:
        """
        response = requests.post("http://localhost:11434/api/generate", json={
            "model": "llama2",
            "prompt": prompt
        })
        sql_query = response.json().get("response", "").strip()

        st.subheader("🔍 Generated SQL")
        st.code(sql_query, language="sql")

        # Execute SQL
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute(sql_query)
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]

            import pandas as pd
            df = pd.DataFrame.from_records(rows, columns=columns)

            st.subheader("📊 Results")
            st.dataframe(df)

            # Show success % if available
            if "successPercentage" in df.columns:
                st.metric("Success Percentage", f"{df['successPercentage'][0]:.2f}%")

        except Exception as e:
            st.error(f"Error: {e}")
