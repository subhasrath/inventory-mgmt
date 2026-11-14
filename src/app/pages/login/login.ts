import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Auth } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  imports: [FormsModule, RouterLink, NgIf],
  selector: 'app-login',
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class Login {
  username = '';
  password = '';
  loading = false;
  error = '';

  private http = inject(HttpClient);
  private auth = inject(Auth);
  private router = inject(Router);

  doLogin() {
    this.error = '';
    this.loading = true;

    this.http.post<any>(`${environment.apiBaseUrl}/users/login`, {
      username: this.username,
      password: this.password
    }).subscribe({
      next: (res) => {
        this.loading = false;
        if (res.success) {
          this.auth.setUser(
            {
              userID: res.userID,
              fullName: res.fullName,
              username: res.username,
              role: res.role
            },
            res.token                       // ← pass JWT
          );
          this.router.navigateByUrl('/dashboard');
        } else {
          this.error = res.message;
        }
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message ?? 'Login failed';
      }
    });
  }
}