--
-- PostgreSQL database cluster dump
--

\restrict nTf0ID1sLhx30DfNQTbJoQtgVHpoSz3wAuA12ROMSavgi90P8aeeAxslgsmb9Bz

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE aetheria;
ALTER ROLE aetheria WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:hZX/cvw3lKh6UXnRs3JEug==$aL0kMHa7OgGRwNz1rX7F/Ts4rYpW9DrZHZnF4JVQ+SY=:hlyXuJmDGTcA4KXYOLxMW/6BkD6qBfP4+yK9Gjokkgk=';

--
-- User Configurations
--








\unrestrict nTf0ID1sLhx30DfNQTbJoQtgVHpoSz3wAuA12ROMSavgi90P8aeeAxslgsmb9Bz

--
-- PostgreSQL database cluster dump complete
--

