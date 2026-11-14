import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Auth } from '../../services/auth';
import { environment } from '../../../environments/environment.development';

@Component({
  imports: [FormsModule, RouterLink, NgIf],
  selector: 'app-signup',
  styleUrl: './signup.css',
  templateUrl: './signup.html',
})
export class Signup {
  fullName = '';
  username = '';
  password = '';
  confirmPassword = '';
  loading = false;
  error = '';

  private http = inject(HttpClient);
  private auth = inject(Auth);
  private router = inject(Router);

  doSignup() {
    this.error = '';
    this.loading = true;

    this.http.post<any>(`${environment.apiBaseUrl}/users/signup`, {
      fullName: this.fullName,
      username: this.username,
      password: this.password,
      confirmPassword: this.confirmPassword
    }).subscribe({
      next: (res) => {
        this.loading = false;
        if (res.success) {
          this.auth.setUser({
            userID: res.userID,
            fullName: res.fullName,
            username: res.username,
            role: res.role
          });
          this.router.navigateByUrl('/dashboard');
        } else {
          this.error = res.message;
        }
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message ?? 'Signup failed';
      }
    });
  }
}
