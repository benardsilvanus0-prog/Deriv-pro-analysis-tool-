"use strict";

/*
=========================================================
EXPERT TRADER AUTHENTICATION CLIENT
=========================================================
*/


async function checkAuthentication(){

  try{

    const response =
      await fetch(
        "/.netlify/functions/session",
        {
          method:"GET",
          credentials:"include"
        }
      );

    const data =
      await response.json();

    if(
      !response.ok ||
      !data.authenticated
    ){

      window.location.replace(
        "/login.html"
      );

      return false;
    }

    return true;

  }catch(error){

    console.error(
      "Authentication check failed:",
      error
    );

    window.location.replace(
      "/login.html"
    );

    return false;
  }
}


/* =====================================================
   LOGOUT
===================================================== */

async function logoutUser(){

  try{

    await fetch(
      "/.netlify/functions/logout",
      {
        method:"POST",
        credentials:"include"
      }
    );

  }catch(error){

    console.error(
      "Logout error:",
      error
    );

  }finally{

    window.location.replace(
      "/login.html"
    );

  }
}


/* =====================================================
   INITIAL AUTH CHECK
===================================================== */

checkAuthentication();


/* =====================================================
   CONNECT EXISTING LOGOUT BUTTON
===================================================== */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const logout =
      document.getElementById(
        "logout"
      );

    if(logout){

      logout.addEventListener(
        "click",
        event => {

          event.preventDefault();

          logoutUser();

        }
      );

    }

  }
);
